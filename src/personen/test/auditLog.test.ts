import { Logger } from '@aws-lambda-powertools/logger';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { AuditLog } from '../auditLog';
import { MissingAuditLogHeadersError } from '../subset/errors/subset-errors';

const cloudWatchMock = mockClient(CloudWatchClient);
const ddbMock = mockClient(DynamoDBClient);

const SALT = 'test-salt';
// HMAC-SHA256('test-salt', '999971785'), also reproducible with: printf '999971785' | openssl dgst -sha256 -hmac 'test-salt'
const HASH_999971785 = '3c909c6a01bc997a512c67730b15e961bcb8c64c8c72b8cae41af9bd7c16ecfa';

// A returned person without burgerservicenummer, so the requested BSNs are logged
const PERSON_WITHOUT_BSN = { personen: [{ naam: {} }] };

const HEADERS = { 'x-gebruiker': 'medewerker-1', 'x-doelbinding': 'BRPACT-Totaal' };

function event(headers: Record<string, string | undefined> | null = HEADERS) {
  return {
    headers,
    resource: '/personen',
    requestContext: {
      requestId: 'req-1',
      requestTimeEpoch: Date.parse('2026-11-16T10:00:00.123Z'),
      identity: { apiKeyId: 'key-id' },
    },
  };
}

function start(headers?: Record<string, string | undefined> | null, requestBsns: string[] = ['999971785']) {
  return AuditLog.start(event(headers), {
    application: 'ApiKeyTest',
    requestType: 'RaadpleegMetBurgerservicenummer',
    fields: ['naam'],
    salt: SALT,
    requestBsns,
  });
}

function writtenItems() {
  return ddbMock.commandCalls(BatchWriteItemCommand)
    .flatMap(call => call.args[0].input.RequestItems?.AuditLogTable ?? [])
    .map(request => request.PutRequest?.Item ?? {});
}

function bronnen() {
  return writtenItems().map(item => ({ bsnHash: item.bsnHash.S, bron: item.bron.S }));
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(BatchWriteItemCommand).resolves({});
  cloudWatchMock.reset();
  cloudWatchMock.on(PutMetricDataCommand).resolves({});
  process.env.AUDIT_LOG_TABLE_NAME = 'AuditLogTable';
  delete process.env.ENFORCE_AUDIT_LOG_HEADERS;
});

describe('AuditLog.hashBsn', () => {
  it('returns the lowercase hex HMAC-SHA256 of the BSN', () => {
    expect(AuditLog.hashBsn('999971785', SALT)).toBe(HASH_999971785);
  });

  it('ignores surrounding whitespace', () => {
    expect(AuditLog.hashBsn(' 999971785 ', SALT)).toBe(HASH_999971785);
  });

  it('gives a different hash for a different salt', () => {
    expect(AuditLog.hashBsn('999971785', 'other-salt')).not.toBe(HASH_999971785);
  });
});

describe('AuditLog.requestedBsns', () => {
  it('returns the BSNs of a lookup by BSN', () => {
    expect(AuditLog.requestedBsns({ type: 'RaadpleegMetBurgerservicenummer', burgerservicenummer: ['999971785', '999999333'] }))
      .toEqual(['999971785', '999999333']);
  });

  it('returns no BSNs for other search types', () => {
    expect(AuditLog.requestedBsns({ type: 'ZoekMetPostcodeEnHuisnummer', postcode: '6511PP' })).toEqual([]);
    expect(AuditLog.requestedBsns({ type: 'ZoekMetPostcodeEnHuisnummer', burgerservicenummer: ['999971785'] })).toEqual([]);
    expect(AuditLog.requestedBsns(undefined)).toEqual([]);
  });

  it('ignores values that are not a 9 digit BSN', () => {
    expect(AuditLog.requestedBsns({
      type: 'RaadpleegMetBurgerservicenummer',
      burgerservicenummer: ['999971785', 999999333, ' 999999333', '12345', 'abcdefghi'],
    })).toEqual(['999971785']);
  });

  it('takes at most 20 BSNs, the Haal Centraal maximum', () => {
    const bsns = Array.from({ length: 25 }, (_, i) => String(100000000 + i));
    expect(AuditLog.requestedBsns({ type: 'RaadpleegMetBurgerservicenummer', burgerservicenummer: bsns })).toEqual(bsns.slice(0, 20));
  });
});

describe('AuditLog.start', () => {
  it('reads the primary headers', async () => {
    await (await start()).write(PERSON_WITHOUT_BSN);
    expect(writtenItems()[0]).toMatchObject({
      gebruiker: { S: 'medewerker-1' },
      gebruikerHeader: { S: 'x-gebruiker' },
      doelbinding: { S: 'BRPACT-Totaal' },
      doelbindingHeader: { S: 'x-doelbinding' },
    });
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });

  it.each([
    ['x-user', 'x-purpose'],
    ['X-Medewerker', 'X-Doel'],
  ])('accepts the alias headers %s and %s, case-insensitive', async (userHeader, doelbindingHeader) => {
    const auditLog = await start({ [userHeader]: 'medewerker-1', [doelbindingHeader]: 'BRPACT-Totaal' });
    await auditLog.write(PERSON_WITHOUT_BSN);
    expect(writtenItems()[0]).toMatchObject({
      gebruiker: { S: 'medewerker-1' },
      gebruikerHeader: { S: userHeader.toLowerCase() },
      doelbinding: { S: 'BRPACT-Totaal' },
      doelbindingHeader: { S: doelbindingHeader.toLowerCase() },
    });
  });

  it('uses the first header in priority order when several are present', async () => {
    const auditLog = await start({
      'x-medewerker': 'from-medewerker',
      'x-gebruiker': 'from-gebruiker',
      'x-doelbinding': 'BRPACT-Totaal',
    });
    await auditLog.write(PERSON_WITHOUT_BSN);
    expect(writtenItems()[0]).toMatchObject({ gebruiker: { S: 'from-gebruiker' }, gebruikerHeader: { S: 'x-gebruiker' } });
  });

  it('skips headers with an empty value', async () => {
    const auditLog = await start({ 'x-gebruiker': '  ', 'x-user': 'medewerker-1', 'x-doelbinding': 'BRPACT-Totaal' });
    await auditLog.write(PERSON_WITHOUT_BSN);
    expect(writtenItems()[0]).toMatchObject({ gebruiker: { S: 'medewerker-1' }, gebruikerHeader: { S: 'x-user' } });
  });

  it('reads the optional headers when present', async () => {
    const auditLog = await start({
      ...HEADERS,
      'X-Verwerking': 'Burgerzaken',
      'x-afnemer-oin': '00000001234567890000',
      'Fsc-Transaction-Id': '018f6b1c-0000-7000-8000-000000000000',
    });
    await auditLog.write(PERSON_WITHOUT_BSN);
    expect(writtenItems()[0]).toMatchObject({
      verwerking: { S: 'Burgerzaken' },
      afnemerOin: { S: '00000001234567890000' },
      fscTransactionId: { S: '018f6b1c-0000-7000-8000-000000000000' },
    });
  });

  it('logs onbekend and emits a metric when headers are missing and not enforced', async () => {
    const auditLog = await start({ 'x-gebruiker': 'medewerker-1' });
    await auditLog.write(PERSON_WITHOUT_BSN);
    const item = writtenItems()[0];
    expect(item.gebruiker).toEqual({ S: 'medewerker-1' });
    expect(item.doelbinding).toEqual({ S: 'onbekend' });
    expect(item.doelbindingHeader).toBeUndefined();

    const calls = cloudWatchMock.commandCalls(PutMetricDataCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.Namespace).toBe('HaalCentraal');
    expect(input.MetricData?.[0].MetricName).toBe('MissingAuditLogHeaders');
    expect(input.MetricData?.[0].Dimensions).toEqual([{ Name: 'Application', Value: 'ApiKeyTest' }]);
  });

  it('handles a missing headers object', async () => {
    const auditLog = await start(null);
    await auditLog.write(PERSON_WITHOUT_BSN);
    expect(writtenItems()[0]).toMatchObject({ gebruiker: { S: 'onbekend' }, doelbinding: { S: 'onbekend' } });
  });

  it('does not fail when the metric cannot be sent', async () => {
    cloudWatchMock.on(PutMetricDataCommand).rejects(new Error('CloudWatch down'));
    await expect(start({})).resolves.toBeInstanceOf(AuditLog);
  });

  it('throws a 400 error when headers are missing and enforced', async () => {
    process.env.ENFORCE_AUDIT_LOG_HEADERS = 'true';
    const promise = start({ 'x-gebruiker': 'medewerker-1' });
    await expect(promise).rejects.toBeInstanceOf(MissingAuditLogHeadersError);
    await expect(promise).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required header for doelbinding (one of: x-doelbinding, x-purpose, x-doel)',
    });
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });
});

describe('write', () => {
  const hash = (bsn: string) => AuditLog.hashBsn(bsn, SALT);

  it('writes one item per person with the hashed BSN as key', async () => {
    const auditLog = await start({ ...HEADERS, 'fsc-transaction-id': 'fsc-1' }, ['999971785', '999999333']);
    await auditLog.write({ personen: [{ burgerservicenummer: '999971785' }] });

    const items = writtenItems();
    expect(items).toEqual([{
      bsnHash: { S: HASH_999971785 },
      requestedAt: { S: '2026-11-16T10:00:00.123Z#req-1' },
      requestId: { S: 'req-1' },
      application: { S: 'ApiKeyTest' },
      apiKeyId: { S: 'key-id' },
      endpoint: { S: '/personen' },
      requestType: { S: 'RaadpleegMetBurgerservicenummer' },
      fields: { L: [{ S: 'naam' }] },
      bron: { S: 'antwoord' },
      gebruiker: { S: 'medewerker-1' },
      gebruikerHeader: { S: 'x-gebruiker' },
      doelbinding: { S: 'BRPACT-Totaal' },
      doelbindingHeader: { S: 'x-doelbinding' },
      fscTransactionId: { S: 'fsc-1' },
    }]);
  });

  it('never stores the plain BSN', async () => {
    await (await start()).write({ personen: [{ burgerservicenummer: '999971785' }] });
    expect(JSON.stringify(writtenItems())).not.toContain('999971785');
  });

  it('logs the persons in the response, not the requested BSNs', async () => {
    await (await start(HEADERS, ['999971785', '999999333'])).write({ personen: [{ burgerservicenummer: '999999333' }] });
    expect(bronnen()).toEqual([{ bsnHash: hash('999999333'), bron: 'antwoord' }]);
  });

  it('logs the persons in the response of a search without requested BSNs', async () => {
    await (await start(HEADERS, [])).write({ personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: '999999333' }] });
    expect(bronnen()).toEqual([
      { bsnHash: hash('999971785'), bron: 'antwoord' },
      { bsnHash: hash('999999333'), bron: 'antwoord' },
    ]);
  });

  it('logs the requested BSNs when the response has none', async () => {
    await (await start(HEADERS, ['999971785', '999999333'])).write({ personen: [{ naam: {} }] });
    expect(bronnen()).toEqual([
      { bsnHash: hash('999971785'), bron: 'verzoek' },
      { bsnHash: hash('999999333'), bron: 'verzoek' },
    ]);
  });

  it('ignores response values that are not a 9 digit BSN', async () => {
    await (await start()).write({ personen: [{ burgerservicenummer: '12345' }, { burgerservicenummer: 999999333 }] });
    expect(bronnen()).toEqual([{ bsnHash: HASH_999971785, bron: 'verzoek' }]);
  });

  it.each([
    ['no persons', { personen: [] }],
    ['no body', undefined],
  ])('writes nothing and does not warn when %s are returned', async (_, body) => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    await (await start()).write(body);
    expect(ddbMock.commandCalls(BatchWriteItemCommand)).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('deduplicates BSNs', async () => {
    await (await start()).write({ personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: ' 999971785' }] });
    expect(bronnen()).toEqual([{ bsnHash: HASH_999971785, bron: 'antwoord' }]);
  });

  it('writes nothing and warns for a search without requested BSNs and without BSNs in the response', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    await (await start(HEADERS, [])).write({ personen: [{ naam: {} }] });
    expect(ddbMock.commandCalls(BatchWriteItemCommand)).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('No BSNs to log for request', { application: 'ApiKeyTest', requestType: 'RaadpleegMetBurgerservicenummer' });
    warn.mockRestore();
  });

  it('ignores empty BSN values', async () => {
    await (await start(HEADERS, ['', '  '])).write({ personen: [{ burgerservicenummer: '' }] });
    expect(ddbMock.commandCalls(BatchWriteItemCommand)).toHaveLength(0);
  });

  describe('batching', () => {
    const bsns = (count: number) => Array.from({ length: count }, (_, i) => String(100000000 + i));
    const unprocessed = { AuditLogTable: [{ PutRequest: { Item: { bsnHash: { S: 'x' } } } }] };

    it('splits more than 25 persons into several batches', async () => {
      await (await start(HEADERS, bsns(30))).write(PERSON_WITHOUT_BSN);
      const calls = ddbMock.commandCalls(BatchWriteItemCommand);
      expect(calls.map(call => call.args[0].input.RequestItems?.AuditLogTable?.length)).toEqual([25, 5]);
    });

    it('retries unprocessed items', async () => {
      ddbMock.on(BatchWriteItemCommand).resolvesOnce({ UnprocessedItems: unprocessed }).resolves({});
      await (await start(HEADERS, bsns(2))).write(PERSON_WITHOUT_BSN);

      const calls = ddbMock.commandCalls(BatchWriteItemCommand);
      expect(calls).toHaveLength(2);
      expect(calls[1].args[0].input.RequestItems?.AuditLogTable).toEqual(unprocessed.AuditLogTable);
    });

    it('throws when items stay unprocessed', async () => {
      ddbMock.on(BatchWriteItemCommand).resolves({ UnprocessedItems: unprocessed });
      await expect((await start(HEADERS, bsns(1))).write(PERSON_WITHOUT_BSN)).rejects.toThrow('Could not write audit log');
      expect(ddbMock.commandCalls(BatchWriteItemCommand)).toHaveLength(4);
    });

    it('throws when DynamoDB fails', async () => {
      ddbMock.on(BatchWriteItemCommand).rejects(new Error('DynamoDB down'));
      await expect((await start(HEADERS, bsns(1))).write(PERSON_WITHOUT_BSN)).rejects.toThrow('DynamoDB down');
    });
  });
});
