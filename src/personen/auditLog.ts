import * as crypto from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { AttributeValue, BatchWriteItemCommand, DynamoDBClient, WriteRequest } from '@aws-sdk/client-dynamodb';
import { MissingAuditLogHeadersError } from './subset/errors/subset-errors';

const cloudwatch = new CloudWatchClient({ region: 'eu-central-1' });
const dynamodb = new DynamoDBClient();
const logger = new Logger({ serviceName: 'HaalCentraal' });

const BSN_FIELD = 'burgerservicenummer';
const MAX_REQUESTED_BSNS = 20; // Haal Centraal maximum for RaadpleegMetBurgerservicenummer
const BATCH_SIZE = 25; // DynamoDB BatchWriteItem limit
const MAX_ATTEMPTS = 4;
const UNKNOWN_HEADER_VALUE = 'onbekend';

/**
 * Accepted request headers per logged value, in priority order. Header names are matched
 * case-insensitively and the first header with a non-empty value is used.
 */
const AUDIT_LOG_HEADERS = {
  gebruiker: ['x-gebruiker', 'x-user', 'x-medewerker'],
  doelbinding: ['x-doelbinding', 'x-purpose', 'x-doel'],
  verwerking: ['x-verwerking', 'x-processing'],
  afnemerOin: ['x-origin-oin', 'x-afnemer-oin'],
  fscTransactionId: ['fsc-transaction-id'],
};

/**
 * Outcome for one person in an audit log record.
 * - gevonden: the person was returned
 * - geen-resultaat: the BSN was searched for but not returned
 * - fout: Haal Centraal returned an error for the request
 */
type Resultaat = 'gevonden' | 'geen-resultaat' | 'fout';

interface Target {
  bsn: string;
  resultaat: Resultaat;
}

/**
 * Values taken from the request headers. The *Header properties hold the name of the
 * header the value was read from.
 */
interface Headers {
  gebruiker: string;
  gebruikerHeader?: string;
  doelbinding: string;
  doelbindingHeader?: string;
  verwerking?: string;
  afnemerOin?: string;
  fscTransactionId?: string;
}

/**
 * Request details from the API Gateway event, shared by all records of a request
 */
interface RequestContext {
  requestId: string;
  requestTime: Date;
  apiKeyId: string;
  endpoint: string;
}

export interface AuditLogOptions {
  /**
   * Application name, logged and used in the missing header metric
   */
  application: string;
  /**
   * Type of request, e.g. the Haal Centraal search type
   */
  requestType: string;
  /**
   * Fields as requested by the client, without fields added internally
   */
  fields: string[];
  /**
   * Secret salt for hashing BSNs in this environment
   */
  salt: string;
}

/**
 * Audit log of a single request for person data: who asked which persons' data, for which
 * purpose, and what was returned. One record per person is written to the audit log table.
 */
export class AuditLog {
  /**
   * Read the values to log from the request headers and the request details from the event.
   * When gebruiker or doelbinding is missing the value is logged as 'onbekend' and a metric is
   * emitted, or, when ENFORCE_AUDIT_LOG_HEADERS is 'true', the request is rejected.
   * @param event API Gateway proxy event
   * @param options Application, request type, requested fields and BSN hash salt
   * @returns Audit log for this request
   * @throws MissingAuditLogHeadersError when enforced and a required header is missing
   */
  static async start(event: any, options: AuditLogOptions): Promise<AuditLog> {
    const headers = await readHeaders(event?.headers, options.application);
    return new AuditLog(requestContext(event), headers, options);
  }

  /**
   * BSNs a personen request searches for. Only RaadpleegMetBurgerservicenummer has them.
   * Values that are not a 9 digit BSN are ignored, and at most 20 are taken.
   * @param request Parsed personen request body
   * @returns BSNs from the request, empty for other search types
   */
  static requestedBsns(request: any): string[] {
    const bsns = request?.[BSN_FIELD];
    if (request?.type !== 'RaadpleegMetBurgerservicenummer' || !Array.isArray(bsns)) {
      return [];
    }
    return bsns
      .filter(bsn => typeof bsn === 'string' && /^\d{9}$/.test(bsn))
      .slice(0, MAX_REQUESTED_BSNS);
  }

  /**
   * Hash a BSN with the environment specific salt, so records can be found by BSN
   * without storing the BSN itself.
   * @param bsn Burgerservicenummer
   * @param salt Secret salt for this environment
   * @returns Lowercase hex HMAC-SHA256
   */
  static hashBsn(bsn: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(bsn.trim()).digest('hex');
  }

  private constructor(
    private readonly context: RequestContext,
    private readonly headers: Headers,
    private readonly options: AuditLogOptions,
  ) {}

  /**
   * Make sure burgerservicenummer is requested from Haal Centraal, so the persons in the
   * response can be logged.
   * @param fields Fields to request from Haal Centraal
   * @returns The fields including burgerservicenummer
   */
  withBsnField(fields: string[]): string[] {
    if (fields.includes(BSN_FIELD)) {
      return fields;
    }
    return [...fields, BSN_FIELD];
  }

  /**
   * Remove burgerservicenummer from the returned persons when the client did not ask for it.
   * @param data Parsed Haal Centraal response body
   * @returns The response body as the client requested it
   */
  withoutBsnField(data: any): any {
    if (this.options.fields.includes(BSN_FIELD) || !Array.isArray(data?.personen)) {
      return data;
    }
    const personen = data.personen.map((persoon: any) => {
      const rest = { ...persoon };
      delete rest[BSN_FIELD];
      return rest;
    });
    return { ...data, personen };
  }

  /**
   * Write the audit log records for the Haal Centraal response: one per BSN that was searched
   * for and per person that was returned. Write before checking the response, so errors and
   * empty results are logged too.
   * Throws when not every record could be written, so the caller can refuse to return data.
   * @param requestedBsns BSNs searched for, may be empty for searches
   * @param result Haal Centraal response
   * @returns The parsed response body, or undefined when it is not valid JSON
   */
  async write(requestedBsns: string[], result: { statusCode: number; body: string }): Promise<any> {
    const data = parseBody(result.body);
    const targets = collectTargets(requestedBsns, result.statusCode, data);
    if (targets.length === 0) {
      logger.info('No persons to log for request', { application: this.options.application, requestType: this.options.requestType });
      return data;
    }

    const tableName = process.env.AUDIT_LOG_TABLE_NAME!;
    const requests: WriteRequest[] = this.items(targets, result.statusCode).map(item => ({ PutRequest: { Item: item } }));

    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      let pending = requests.slice(i, i + BATCH_SIZE);
      for (let attempt = 1; pending.length > 0 && attempt <= MAX_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          await sleep(50 * 2 ** (attempt - 2));
        }
        const response = await dynamodb.send(new BatchWriteItemCommand({ RequestItems: { [tableName]: pending } }));
        pending = response?.UnprocessedItems?.[tableName] ?? [];
      }
      if (pending.length > 0) {
        throw new Error(`Could not write audit log: ${pending.length} records unprocessed`);
      }
    }
    return data;
  }

  private items(targets: Target[], statusCode: number): Record<string, AttributeValue>[] {
    const requestedAt = `${this.context.requestTime.toISOString()}#${this.context.requestId}`;
    const optional: Record<string, string | undefined> = {
      gebruikerHeader: this.headers.gebruikerHeader,
      doelbindingHeader: this.headers.doelbindingHeader,
      verwerking: this.headers.verwerking,
      afnemerOin: this.headers.afnemerOin,
      fscTransactionId: this.headers.fscTransactionId,
    };

    return targets.map(target => {
      const item: Record<string, AttributeValue> = {
        bsnHash: { S: AuditLog.hashBsn(target.bsn, this.options.salt) },
        requestedAt: { S: requestedAt },
        requestId: { S: this.context.requestId },
        application: { S: this.options.application },
        apiKeyId: { S: this.context.apiKeyId },
        endpoint: { S: this.context.endpoint },
        requestType: { S: this.options.requestType },
        fields: { L: this.options.fields.map(field => ({ S: field })) },
        statusCode: { N: String(statusCode) },
        resultaat: { S: target.resultaat },
        gebruiker: { S: this.headers.gebruiker },
        doelbinding: { S: this.headers.doelbinding },
      };
      for (const [key, value] of Object.entries(optional)) {
        if (value) {
          item[key] = { S: value };
        }
      }
      return item;
    });
  }
}

function requestContext(event: any): RequestContext {
  const context = event?.requestContext;
  return {
    requestId: context?.requestId ?? crypto.randomUUID(),
    requestTime: new Date(context?.requestTimeEpoch ?? Date.now()),
    apiKeyId: context?.identity?.apiKeyId ?? 'unknown apiKeyId',
    endpoint: event?.resource ?? event?.path ?? 'unknown',
  };
}

async function readHeaders(headers: Record<string, string | undefined> | null | undefined, application: string): Promise<Headers> {
  const lowercased: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value && value.trim().length > 0) {
      lowercased[name.toLowerCase()] = value.trim();
    }
  }

  const gebruiker = findHeader(lowercased, 'gebruiker');
  const doelbinding = findHeader(lowercased, 'doelbinding');

  const missing: { attribute: string; headers: string[] }[] = [];
  if (!gebruiker) {
    missing.push({ attribute: 'gebruiker', headers: AUDIT_LOG_HEADERS.gebruiker });
  }
  if (!doelbinding) {
    missing.push({ attribute: 'doelbinding', headers: AUDIT_LOG_HEADERS.doelbinding });
  }

  if (missing.length > 0) {
    if (process.env.ENFORCE_AUDIT_LOG_HEADERS === 'true') {
      throw new MissingAuditLogHeadersError(missing);
    }
    logger.warn('Missing audit log headers', {
      application,
      missing: missing.map(m => m.attribute),
    });
    await emitMissingHeadersMetric(application);
  }

  return {
    gebruiker: gebruiker?.value ?? UNKNOWN_HEADER_VALUE,
    gebruikerHeader: gebruiker?.name,
    doelbinding: doelbinding?.value ?? UNKNOWN_HEADER_VALUE,
    doelbindingHeader: doelbinding?.name,
    verwerking: findHeader(lowercased, 'verwerking')?.value,
    afnemerOin: findHeader(lowercased, 'afnemerOin')?.value,
    fscTransactionId: findHeader(lowercased, 'fscTransactionId')?.value,
  };
}

function findHeader(headers: Record<string, string>, attribute: keyof typeof AUDIT_LOG_HEADERS) {
  const present = AUDIT_LOG_HEADERS[attribute].filter(name => headers[name] !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  if (new Set(present.map(name => headers[name])).size > 1) {
    logger.warn('Conflicting audit log headers, using the first', { attribute, headers: present });
  }
  return { name: present[0], value: headers[present[0]] };
}

/**
 * Emit the missing audit log headers metric. A metrics failure is logged and never
 * breaks the request.
 * @param application Application name used as the metric dimension
 */
async function emitMissingHeadersMetric(application: string): Promise<void> {
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'HaalCentraal',
      MetricData: [
        {
          MetricName: 'MissingAuditLogHeaders',
          Dimensions: [
            {
              Name: 'Application',
              Value: application.substring(0, 255), // CloudWatch dimension value limit
            },
          ],
          Value: 1,
          Unit: StandardUnit.Count,
          Timestamp: new Date(),
        },
      ],
    }));
  } catch (error) {
    logger.error('Error sending missing audit log headers metric to CloudWatch', { error });
  }
}

/**
 * Determine the persons a request concerns: every BSN that was searched for and every
 * person that was returned.
 * @param requestBsns BSNs from the request (body or header), may be empty for searches
 * @param statusCode Status code of the Haal Centraal response
 * @param responseBody Parsed Haal Centraal response body
 * @returns One target per distinct BSN
 */
function collectTargets(requestBsns: string[], statusCode: number, responseBody?: any): Target[] {
  const requested = unique(requestBsns);

  if (statusCode < 200 || statusCode >= 300) {
    return requested.map(bsn => ({ bsn, resultaat: 'fout' }));
  }

  const personen: any[] = Array.isArray(responseBody?.personen) ? responseBody.personen : [];
  const returned = unique(personen.map(persoon => persoon?.[BSN_FIELD]).filter(bsn => typeof bsn === 'string'));

  const targets: Target[] = requested.map(bsn => ({
    bsn,
    resultaat: returned.includes(bsn) ? 'gevonden' : 'geen-resultaat',
  }));
  for (const bsn of returned) {
    if (!requested.includes(bsn)) {
      targets.push({ bsn, resultaat: 'gevonden' });
    }
  }
  return targets;
}

function parseBody(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unique(bsns: string[]): string[] {
  return [...new Set(bsns.map(bsn => bsn.trim()).filter(bsn => bsn.length > 0))];
}
