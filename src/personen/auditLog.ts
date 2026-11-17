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
 * Where the BSNs in an audit log record come from.
 * - antwoord: the persons in the Haal Centraal response
 * - verzoek: the BSNs in the request, used when the response has no BSNs
 */
type Bron = 'antwoord' | 'verzoek';

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
  /**
   * BSNs the request asks for, empty for a search on other data
   */
  requestBsns: string[];
}

/**
 * Audit log of a single request for person data: who asked which persons' data and for which
 * purpose. One record per person is written to the audit log table.
 *
 * Start it when the request comes in, to check the headers, and write it just before
 * returning person data to the client.
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
   * Write the audit log records, one per person. The persons are the BSNs in the response
   * or, when the response has none, the BSNs in the request. When there are neither, nothing
   * is written and a warning is logged.
   * Throws when not every record could be written, so the caller can refuse to return data.
   * @param responseBody Parsed Haal Centraal response body
   */
  async write(responseBody: any): Promise<void> {
    const responseBsns = bsnsInResponse(responseBody);
    const requestBsns = unique(this.options.requestBsns);
    const bron: Bron = responseBsns.length > 0 ? 'antwoord' : 'verzoek';
    const bsns = bron === 'antwoord' ? responseBsns : requestBsns;
    if (bsns.length === 0) {
      logger.warn('No BSNs to log for request', { application: this.options.application, requestType: this.options.requestType });
      return;
    }

    const tableName = process.env.AUDIT_LOG_TABLE_NAME!;
    const requests: WriteRequest[] = this.items(bsns, bron).map(item => ({ PutRequest: { Item: item } }));

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
  }

  private items(bsns: string[], bron: Bron): Record<string, AttributeValue>[] {
    const requestedAt = `${this.context.requestTime.toISOString()}#${this.context.requestId}`;
    const optional: Record<string, string | undefined> = {
      gebruikerHeader: this.headers.gebruikerHeader,
      doelbindingHeader: this.headers.doelbindingHeader,
      verwerking: this.headers.verwerking,
      afnemerOin: this.headers.afnemerOin,
      fscTransactionId: this.headers.fscTransactionId,
    };

    return bsns.map(bsn => {
      const item: Record<string, AttributeValue> = {
        bsnHash: { S: AuditLog.hashBsn(bsn, this.options.salt) },
        requestedAt: { S: requestedAt },
        requestId: { S: this.context.requestId },
        application: { S: this.options.application },
        apiKeyId: { S: this.context.apiKeyId },
        endpoint: { S: this.context.endpoint },
        requestType: { S: this.options.requestType },
        fields: { L: this.options.fields.map(field => ({ S: field })) },
        bron: { S: bron },
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

function bsnsInResponse(responseBody: any): string[] {
  const personen: any[] = Array.isArray(responseBody?.personen) ? responseBody.personen : [];
  return unique(personen.map(persoon => persoon?.[BSN_FIELD]).filter(bsn => typeof bsn === 'string'));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unique(bsns: string[]): string[] {
  return [...new Set(bsns.map(bsn => bsn.trim()).filter(bsn => bsn.length > 0))];
}
