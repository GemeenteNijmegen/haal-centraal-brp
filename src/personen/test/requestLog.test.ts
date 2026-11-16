import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { BatchWriteItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import {
  buildRequestLogItems,
  collectTargets,
  getRequestedBsns,
  getRequestLogHeaders,
  hashBsn,
  RequestLogEntry,
  RequestLogTarget,
  stripBsnField,
  withBsnField,
  writeRequestLog,
} from '../requestLog';
import { MissingRequestLogHeadersError } from '../subset/errors/subset-errors';

const cloudWatchMock = mockClient(CloudWatchClient);
const ddbMock = mockClient(DynamoDBClient);

const SALT = 'test-salt';
// HMAC-SHA256('test-salt', '999971785'), also reproducible with: printf '999971785' | openssl dgst -sha256 -hmac 'test-salt'
const HASH_999971785 = '3c909c6a01bc997a512c67730b15e961bcb8c64c8c72b8cae41af9bd7c16ecfa';

describe('hashBsn', () => {
  it('returns the lowercase hex HMAC-SHA256 of the BSN', () => {
    expect(hashBsn('999971785', SALT)).toBe(HASH_999971785);
  });

  it('ignores surrounding whitespace', () => {
    expect(hashBsn(' 999971785 ', SALT)).toBe(HASH_999971785);
  });

  it('gives a different hash for a different salt', () => {
    expect(hashBsn('999971785', 'other-salt')).not.toBe(HASH_999971785);
  });
});

describe('collectTargets', () => {
  it('marks a requested BSN that is returned as gevonden', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }] };
    expect(collectTargets(['999971785'], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
    ]);
  });

  it('marks a requested BSN that is not returned as geen-resultaat', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }] };
    expect(collectTargets(['999971785', '999999333'], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
      { bsn: '999999333', resultaat: 'geen-resultaat' },
    ]);
  });

  it('adds returned persons from a search without requested BSNs', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: '999999333' }] };
    expect(collectTargets([], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
      { bsn: '999999333', resultaat: 'gevonden' },
    ]);
  });

  it('deduplicates BSNs', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: '999971785' }] };
    expect(collectTargets(['999971785', ' 999971785'], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
    ]);
  });

  it('marks every requested BSN as fout when Haal Centraal returns an error', () => {
    expect(collectTargets(['999971785', '999999333'], 400, { title: 'Bad request' })).toEqual([
      { bsn: '999971785', resultaat: 'fout' },
      { bsn: '999999333', resultaat: 'fout' },
    ]);
  });

  it('marks requested BSNs as geen-resultaat when the body has no personen', () => {
    expect(collectTargets(['999971785'], 200, {})).toEqual([
      { bsn: '999971785', resultaat: 'geen-resultaat' },
    ]);
    expect(collectTargets(['999971785'], 200, undefined)).toEqual([
      { bsn: '999971785', resultaat: 'geen-resultaat' },
    ]);
  });

  it('returns no targets for a search without BSN and without hits', () => {
    expect(collectTargets([], 200, { personen: [] })).toEqual([]);
  });

  it('ignores empty BSN values', () => {
    expect(collectTargets(['', '  '], 200, { personen: [{ naam: {} }] })).toEqual([]);
  });
});

describe('getRequestedBsns', () => {
  it('returns the BSNs of a lookup by BSN', () => {
    expect(getRequestedBsns({ type: 'RaadpleegMetBurgerservicenummer', burgerservicenummer: ['999971785', 1] })).toEqual(['999971785']);
  });

  it('returns no BSNs for other search types', () => {
    expect(getRequestedBsns({ type: 'ZoekMetPostcodeEnHuisnummer', postcode: '6511PP' })).toEqual([]);
    expect(getRequestedBsns(undefined)).toEqual([]);
  });
});

describe('withBsnField', () => {
  it('adds burgerservicenummer when missing', () => {
    expect(withBsnField(['naam'])).toEqual(['naam', 'burgerservicenummer']);
  });

  it('leaves the fields alone when burgerservicenummer is present', () => {
    const fields = ['burgerservicenummer', 'naam'];
    expect(withBsnField(fields)).toBe(fields);
  });
});

describe('stripBsnField', () => {
  const data = {
    type: 'ZoekMetPostcodeEnHuisnummer',
    personen: [
      { burgerservicenummer: '999971785', naam: { voornamen: 'A' }, partners: [{ burgerservicenummer: '999999333' }] },
    ],
  };

  it('removes burgerservicenummer from each person when it was not requested', () => {
    expect(stripBsnField(data, ['naam', 'partners'])).toEqual({
      type: 'ZoekMetPostcodeEnHuisnummer',
      personen: [
        { naam: { voornamen: 'A' }, partners: [{ burgerservicenummer: '999999333' }] },
      ],
    });
  });

  it('keeps burgerservicenummer when it was requested', () => {
    expect(stripBsnField(data, ['burgerservicenummer', 'naam'])).toBe(data);
  });

  it('leaves a body without personen alone', () => {
    expect(stripBsnField({ title: 'error' }, ['naam'])).toEqual({ title: 'error' });
  });
});

describe('buildRequestLogItems', () => {
  const entry: RequestLogEntry = {
    requestId: 'req-1',
    requestTime: new Date('2026-11-16T10:00:00.123Z'),
    application: 'ApiKeyTest',
    apiKeyId: 'key-id',
    endpoint: '/personen',
    requestType: 'RaadpleegMetBurgerservicenummer',
    fields: ['naam'],
    statusCode: 200,
    headers: {
      gebruiker: 'medewerker-1',
      gebruikerHeader: 'x-gebruiker',
      doelbinding: 'BRPACT-Totaal',
      doelbindingHeader: 'x-doelbinding',
      fscTransactionId: 'fsc-1',
    },
  };

  it('builds one item per target with the hashed BSN as key', () => {
    const items = buildRequestLogItems(entry, [
      { bsn: '999971785', resultaat: 'gevonden' },
      { bsn: '999999333', resultaat: 'geen-resultaat' },
    ], SALT);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      bsnHash: { S: HASH_999971785 },
      requestedAt: { S: '2026-11-16T10:00:00.123Z#req-1' },
      requestId: { S: 'req-1' },
      application: { S: 'ApiKeyTest' },
      apiKeyId: { S: 'key-id' },
      endpoint: { S: '/personen' },
      requestType: { S: 'RaadpleegMetBurgerservicenummer' },
      fields: { L: [{ S: 'naam' }] },
      statusCode: { N: '200' },
      resultaat: { S: 'gevonden' },
      gebruiker: { S: 'medewerker-1' },
      gebruikerHeader: { S: 'x-gebruiker' },
      doelbinding: { S: 'BRPACT-Totaal' },
      doelbindingHeader: { S: 'x-doelbinding' },
      fscTransactionId: { S: 'fsc-1' },
    });
    expect(items[1].resultaat).toEqual({ S: 'geen-resultaat' });
  });

  it('never stores the plain BSN', () => {
    const items = buildRequestLogItems(entry, [{ bsn: '999971785', resultaat: 'gevonden' }], SALT);
    expect(JSON.stringify(items)).not.toContain('999971785');
  });
});

describe('getRequestLogHeaders', () => {
  const options = { enforce: false, application: 'ApiKeyTest' };

  beforeEach(() => {
    cloudWatchMock.reset();
    cloudWatchMock.on(PutMetricDataCommand).resolves({});
  });

  it('reads the primary headers', async () => {
    const result = await getRequestLogHeaders({
      'x-gebruiker': 'medewerker-1',
      'x-doelbinding': 'BRPACT-Totaal',
    }, options);
    expect(result).toEqual({
      gebruiker: 'medewerker-1',
      gebruikerHeader: 'x-gebruiker',
      doelbinding: 'BRPACT-Totaal',
      doelbindingHeader: 'x-doelbinding',
    });
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });

  it.each([
    ['x-user', 'x-purpose'],
    ['X-Medewerker', 'X-Doel'],
  ])('accepts the alias headers %s and %s, case-insensitive', async (userHeader, doelbindingHeader) => {
    const result = await getRequestLogHeaders({
      [userHeader]: 'medewerker-1',
      [doelbindingHeader]: 'BRPACT-Totaal',
    }, options);
    expect(result.gebruiker).toBe('medewerker-1');
    expect(result.gebruikerHeader).toBe(userHeader.toLowerCase());
    expect(result.doelbinding).toBe('BRPACT-Totaal');
    expect(result.doelbindingHeader).toBe(doelbindingHeader.toLowerCase());
  });

  it('uses the first header in priority order when several are present', async () => {
    const result = await getRequestLogHeaders({
      'x-medewerker': 'from-medewerker',
      'x-gebruiker': 'from-gebruiker',
      'x-doelbinding': 'BRPACT-Totaal',
    }, options);
    expect(result.gebruiker).toBe('from-gebruiker');
    expect(result.gebruikerHeader).toBe('x-gebruiker');
  });

  it('skips headers with an empty value', async () => {
    const result = await getRequestLogHeaders({
      'x-gebruiker': '  ',
      'x-user': 'medewerker-1',
      'x-doelbinding': 'BRPACT-Totaal',
    }, options);
    expect(result.gebruiker).toBe('medewerker-1');
    expect(result.gebruikerHeader).toBe('x-user');
  });

  it('reads the optional headers when present', async () => {
    const result = await getRequestLogHeaders({
      'x-gebruiker': 'medewerker-1',
      'x-doelbinding': 'BRPACT-Totaal',
      'X-Verwerking': 'Burgerzaken',
      'x-afnemer-oin': '00000001234567890000',
      'Fsc-Transaction-Id': '018f6b1c-0000-7000-8000-000000000000',
    }, options);
    expect(result.verwerking).toBe('Burgerzaken');
    expect(result.afnemerOin).toBe('00000001234567890000');
    expect(result.fscTransactionId).toBe('018f6b1c-0000-7000-8000-000000000000');
  });

  it('logs onbekend and emits a metric when headers are missing and not enforced', async () => {
    const result = await getRequestLogHeaders({ 'x-gebruiker': 'medewerker-1' }, options);
    expect(result.gebruiker).toBe('medewerker-1');
    expect(result.doelbinding).toBe('onbekend');
    expect(result.doelbindingHeader).toBeUndefined();

    const calls = cloudWatchMock.commandCalls(PutMetricDataCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.Namespace).toBe('HaalCentraal');
    expect(input.MetricData?.[0].MetricName).toBe('MissingRequestLogHeaders');
    expect(input.MetricData?.[0].Dimensions).toEqual([{ Name: 'Application', Value: 'ApiKeyTest' }]);
  });

  it('handles missing headers object', async () => {
    const result = await getRequestLogHeaders(null, options);
    expect(result.gebruiker).toBe('onbekend');
    expect(result.doelbinding).toBe('onbekend');
  });

  it('does not fail when the metric cannot be sent', async () => {
    cloudWatchMock.on(PutMetricDataCommand).rejects(new Error('CloudWatch down'));
    await expect(getRequestLogHeaders({}, options)).resolves.toMatchObject({ gebruiker: 'onbekend' });
  });

  it('throws a 400 error when headers are missing and enforced', async () => {
    const promise = getRequestLogHeaders({ 'x-gebruiker': 'medewerker-1' }, { ...options, enforce: true });
    await expect(promise).rejects.toBeInstanceOf(MissingRequestLogHeadersError);
    await expect(promise).rejects.toMatchObject({
      statusCode: 400,
      message: 'Missing required header for doelbinding (one of: x-doelbinding, x-purpose, x-doel)',
    });
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });
});

describe('writeRequestLog', () => {
  const entry: RequestLogEntry = {
    requestId: 'req-1',
    requestTime: new Date('2026-11-16T10:00:00.123Z'),
    application: 'ApiKeyTest',
    apiKeyId: 'key-id',
    endpoint: '/personen',
    requestType: 'RaadpleegMetBurgerservicenummer',
    fields: ['naam'],
    statusCode: 200,
    headers: { gebruiker: 'medewerker-1', doelbinding: 'BRPACT-Totaal' },
  };
  const targets = (count: number): RequestLogTarget[] =>
    Array.from({ length: count }, (_, i) => ({ bsn: String(100000000 + i), resultaat: 'gevonden' }));

  beforeEach(() => {
    ddbMock.reset();
    process.env.REQUEST_LOG_TABLE_NAME = 'RequestLogTable';
  });

  it('writes one put request per target to the request log table', async () => {
    ddbMock.on(BatchWriteItemCommand).resolves({});
    await writeRequestLog(entry, targets(1), SALT);

    const calls = ddbMock.commandCalls(BatchWriteItemCommand);
    expect(calls).toHaveLength(1);
    const requests = calls[0].args[0].input.RequestItems?.RequestLogTable;
    expect(requests).toHaveLength(1);
    expect(requests?.[0].PutRequest?.Item?.bsnHash).toEqual({ S: hashBsn('100000000', SALT) });
  });

  it('splits more than 25 targets into several batches', async () => {
    ddbMock.on(BatchWriteItemCommand).resolves({});
    await writeRequestLog(entry, targets(30), SALT);

    const calls = ddbMock.commandCalls(BatchWriteItemCommand);
    expect(calls.map(call => call.args[0].input.RequestItems?.RequestLogTable?.length)).toEqual([25, 5]);
  });

  it('retries unprocessed items', async () => {
    ddbMock.on(BatchWriteItemCommand)
      .resolvesOnce({ UnprocessedItems: { RequestLogTable: [{ PutRequest: { Item: { bsnHash: { S: 'x' } } } }] } })
      .resolves({});
    await writeRequestLog(entry, targets(2), SALT);

    const calls = ddbMock.commandCalls(BatchWriteItemCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1].args[0].input.RequestItems?.RequestLogTable).toEqual([{ PutRequest: { Item: { bsnHash: { S: 'x' } } } }]);
  });

  it('throws when items stay unprocessed', async () => {
    ddbMock.on(BatchWriteItemCommand)
      .resolves({ UnprocessedItems: { RequestLogTable: [{ PutRequest: { Item: { bsnHash: { S: 'x' } } } }] } });
    await expect(writeRequestLog(entry, targets(1), SALT)).rejects.toThrow('Could not write request log');
  });

  it('throws when DynamoDB fails', async () => {
    ddbMock.on(BatchWriteItemCommand).rejects(new Error('DynamoDB down'));
    await expect(writeRequestLog(entry, targets(1), SALT)).rejects.toThrow('DynamoDB down');
  });

  it('writes nothing when there are no targets', async () => {
    await writeRequestLog(entry, [], SALT);
    expect(ddbMock.commandCalls(BatchWriteItemCommand)).toHaveLength(0);
  });
});
