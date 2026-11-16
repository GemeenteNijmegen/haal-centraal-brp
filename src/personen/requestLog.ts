import * as crypto from 'crypto';
import { AttributeValue } from '@aws-sdk/client-dynamodb';

const BSN_FIELD = 'burgerservicenummer';

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
