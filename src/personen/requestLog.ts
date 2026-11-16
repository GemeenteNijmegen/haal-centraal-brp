import * as crypto from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { MissingRequestLogHeadersError } from './subset/errors/subset-errors';

const cloudwatch = new CloudWatchClient({ region: 'eu-central-1' });
const logger = new Logger({ serviceName: 'HaalCentraal' });

const BSN_FIELD = 'burgerservicenummer';
export const UNKNOWN_HEADER_VALUE = 'onbekend';

/**
 * Accepted request headers per logged value, in priority order. Header names are matched
 * case-insensitively and the first header with a non-empty value is used.
 */
export const REQUEST_LOG_HEADERS = {
  gebruiker: ['x-gebruiker', 'x-user', 'x-medewerker'],
  doelbinding: ['x-doelbinding', 'x-purpose', 'x-doel'],
  verwerking: ['x-verwerking', 'x-processing'],
  afnemerOin: ['x-origin-oin', 'x-afnemer-oin'],
  fscTransactionId: ['fsc-transaction-id'],
};

/**
 * Outcome for one person in a request log record.
 * - gevonden: the person was returned
 * - geen-resultaat: the BSN was searched for but not returned
 * - fout: Haal Centraal returned an error for the request
 */
export type Resultaat = 'gevonden' | 'geen-resultaat' | 'fout';

export interface RequestLogTarget {
  bsn: string;
  resultaat: Resultaat;
}

/**
 * Values taken from the request headers. The *Header properties hold the name of the
 * header the value was read from.
 */
export interface RequestLogHeaders {
  gebruiker: string;
  gebruikerHeader?: string;
  doelbinding: string;
  doelbindingHeader?: string;
  verwerking?: string;
  afnemerOin?: string;
  fscTransactionId?: string;
}

export interface RequestLogEntry {
  requestId: string;
  requestTime: Date;
  application: string;
  apiKeyId: string;
  endpoint: string;
  requestType: string;
  /**
   * Fields as requested by the client, without fields added internally
   */
  fields: string[];
  statusCode: number;
  headers: RequestLogHeaders;
}

interface RequestLogHeaderOptions {
  /**
   * Reject the request when a required header is missing
   */
  enforce: boolean;
  /**
   * Application name, used in the missing header metric
   */
  application: string;
}

/**
 * Read the values to log from the request headers.
 * When gebruiker or doelbinding is missing the value is logged as 'onbekend' and a metric is
 * emitted, or, when enforced, the request is rejected.
 * @param headers Request headers
 * @param options Enforcement and application name
 * @returns Values to log
 * @throws MissingRequestLogHeadersError when enforced and a required header is missing
 */
export async function getRequestLogHeaders(
  headers: Record<string, string | undefined> | null | undefined,
  options: RequestLogHeaderOptions,
): Promise<RequestLogHeaders> {
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
    missing.push({ attribute: 'gebruiker', headers: REQUEST_LOG_HEADERS.gebruiker });
  }
  if (!doelbinding) {
    missing.push({ attribute: 'doelbinding', headers: REQUEST_LOG_HEADERS.doelbinding });
  }

  if (missing.length > 0) {
    if (options.enforce) {
      throw new MissingRequestLogHeadersError(missing);
    }
    logger.warn('Missing request log headers', {
      application: options.application,
      missing: missing.map(m => m.attribute),
    });
    await emitMissingHeadersMetric(options.application);
  }

  const result: RequestLogHeaders = {
    gebruiker: gebruiker?.value ?? UNKNOWN_HEADER_VALUE,
    gebruikerHeader: gebruiker?.name,
    doelbinding: doelbinding?.value ?? UNKNOWN_HEADER_VALUE,
    doelbindingHeader: doelbinding?.name,
    verwerking: findHeader(lowercased, 'verwerking')?.value,
    afnemerOin: findHeader(lowercased, 'afnemerOin')?.value,
    fscTransactionId: findHeader(lowercased, 'fscTransactionId')?.value,
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as RequestLogHeaders;
}

function findHeader(headers: Record<string, string>, attribute: keyof typeof REQUEST_LOG_HEADERS) {
  const present = REQUEST_LOG_HEADERS[attribute].filter(name => headers[name] !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  if (new Set(present.map(name => headers[name])).size > 1) {
    logger.warn('Conflicting request log headers, using the first', { attribute, headers: present });
  }
  return { name: present[0], value: headers[present[0]] };
}

/**
 * Emit the missing request log headers metric. A metrics failure is logged and never
 * breaks the request.
 * @param application Application name used as the metric dimension
 */
async function emitMissingHeadersMetric(application: string): Promise<void> {
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'HaalCentraal',
      MetricData: [
        {
          MetricName: 'MissingRequestLogHeaders',
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
    logger.error('Error sending missing request log headers metric to CloudWatch', { error });
  }
}

/**
 * Hash a BSN with the environment specific salt, so records can be found by BSN
 * without storing the BSN itself.
 * @param bsn Burgerservicenummer
 * @param salt Secret salt for this environment
 * @returns Lowercase hex HMAC-SHA256
 */
export function hashBsn(bsn: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(bsn.trim()).digest('hex');
}

/**
 * Determine the persons a request concerns: every BSN that was searched for and every
 * person that was returned.
 * @param requestBsns BSNs from the request (body or header), may be empty for searches
 * @param statusCode Status code of the Haal Centraal response
 * @param responseBody Parsed Haal Centraal response body
 * @returns One target per distinct BSN
 */
export function collectTargets(requestBsns: string[], statusCode: number, responseBody?: any): RequestLogTarget[] {
  const requested = unique(requestBsns);

  if (statusCode < 200 || statusCode >= 300) {
    return requested.map(bsn => ({ bsn, resultaat: 'fout' }));
  }

  const personen: any[] = Array.isArray(responseBody?.personen) ? responseBody.personen : [];
  const returned = unique(personen.map(persoon => persoon?.[BSN_FIELD]).filter(bsn => typeof bsn === 'string'));

  const targets: RequestLogTarget[] = requested.map(bsn => ({
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

/**
 * Make sure burgerservicenummer is requested from Haal Centraal, so the persons in the
 * response can be logged.
 * @param fields Fields requested by the client
 * @returns The fields including burgerservicenummer
 */
export function withBsnField(fields: string[]): string[] {
  if (fields.includes(BSN_FIELD)) {
    return fields;
  }
  return [...fields, BSN_FIELD];
}

/**
 * Remove burgerservicenummer from the returned persons when the client did not ask for it.
 * @param data Parsed Haal Centraal response body
 * @param originalFields Fields requested by the client
 * @returns The response body as the client requested it
 */
export function stripBsnField(data: any, originalFields: string[]): any {
  if (originalFields.includes(BSN_FIELD) || !Array.isArray(data?.personen)) {
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
 * Build the DynamoDB items for a request, one per target.
 * @param entry Request details
 * @param targets Persons the request concerns
 * @param salt Secret salt for this environment
 * @returns DynamoDB items
 */
export function buildRequestLogItems(entry: RequestLogEntry, targets: RequestLogTarget[], salt: string): Record<string, AttributeValue>[] {
  const requestedAt = `${entry.requestTime.toISOString()}#${entry.requestId}`;
  const optional: Record<string, string | undefined> = {
    gebruikerHeader: entry.headers.gebruikerHeader,
    doelbindingHeader: entry.headers.doelbindingHeader,
    verwerking: entry.headers.verwerking,
    afnemerOin: entry.headers.afnemerOin,
    fscTransactionId: entry.headers.fscTransactionId,
  };

  return targets.map(target => {
    const item: Record<string, AttributeValue> = {
      bsnHash: { S: hashBsn(target.bsn, salt) },
      requestedAt: { S: requestedAt },
      requestId: { S: entry.requestId },
      application: { S: entry.application },
      apiKeyId: { S: entry.apiKeyId },
      endpoint: { S: entry.endpoint },
      requestType: { S: entry.requestType },
      fields: { L: entry.fields.map(field => ({ S: field })) },
      statusCode: { N: String(entry.statusCode) },
      resultaat: { S: target.resultaat },
      gebruiker: { S: entry.headers.gebruiker },
      doelbinding: { S: entry.headers.doelbinding },
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value) {
        item[key] = { S: value };
      }
    }
    return item;
  });
}

function unique(bsns: string[]): string[] {
  return [...new Set(bsns.map(bsn => bsn.trim()).filter(bsn => bsn.length > 0))];
}
