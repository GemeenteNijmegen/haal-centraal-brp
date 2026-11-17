import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { BatchWriteItemCommand, DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { AuditLog } from '../auditLog';
import { callHaalCentraal } from '../callHaalCentraal';

jest.mock('../initSecrets', () => ({
  initSecrets: jest.fn(() => Promise.resolve({ bsnHashSalt: 'test-salt' })),
}));
jest.mock('../callHaalCentraal');
jest.mock('node-fetch', () => jest.fn());

import { handler } from '../personen.lambda';

const ddbMock = mockClient(DynamoDBClient);
const cloudWatchMock = mockClient(CloudWatchClient);
const mockCallHaalCentraal = callHaalCentraal as jest.MockedFunction<typeof callHaalCentraal>;

const SALT = 'test-salt';

describe('personen lambda handler audit log', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    cloudWatchMock.reset();
    cloudWatchMock.on(PutMetricDataCommand).resolves({});
    ddbMock.on(GetItemCommand).resolves({
      Item: {
        fields: { SS: ['naam', 'burgerservicenummer', 'adressering'] },
        name: { S: 'ApiKeyTest' },
      },
    });
    ddbMock.on(BatchWriteItemCommand).resolves({});
    process.env.ID_TABLE_NAME = 'TestTable';
    process.env.AUDIT_LOG_TABLE_NAME = 'AuditLogTable';
    delete process.env.ENFORCE_AUDIT_LOG_HEADERS;
  });

  const createEvent = (request: any, headers: Record<string, string> = {}) => ({
    body: JSON.stringify(request),
    resource: '/personen',
    headers: { 'x-gebruiker': 'medewerker-1', 'x-doelbinding': 'BRPACT-Totaal', ...headers },
    requestContext: {
      requestId: 'request-1',
      requestTimeEpoch: Date.parse('2026-11-16T10:00:00.000Z'),
      identity: { apiKey: 'test-api-key', apiKeyId: 'test-api-key-id' },
    },
  });

  const respondWith = (statusCode: number, body: any) => {
    mockCallHaalCentraal.mockResolvedValue({
      statusCode,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const writtenItems = () => ddbMock.commandCalls(BatchWriteItemCommand)
    .flatMap(call => call.args[0].input.RequestItems?.AuditLogTable ?? [])
    .map(request => request.PutRequest?.Item);

  const postcodeSearch = (fields: string[]) => ({
    type: 'ZoekMetPostcodeEnHuisnummer',
    fields,
    postcode: '6511PP',
    huisnummer: 1,
  });

  it('sends the request to Haal Centraal and returns the response unchanged', async () => {
    const response = {
      type: 'RaadpleegMetBurgerservicenummer',
      personen: [{ naam: { voornamen: 'A' } }],
    };
    respondWith(200, response);
    const request = { type: 'RaadpleegMetBurgerservicenummer', fields: ['naam'], burgerservicenummer: ['999971785'] };

    const event = createEvent(request);
    const result = await handler(event);

    expect(mockCallHaalCentraal.mock.calls[0][0]).toBe(event.body);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual(response);
  });

  it('logs the requested BSNs when the response has no BSNs', async () => {
    respondWith(200, { personen: [{ naam: { voornamen: 'A' } }] });

    await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['naam'],
      burgerservicenummer: ['999971785', '999999333'],
    }));

    const items = writtenItems();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      bsnHash: { S: AuditLog.hashBsn('999971785', SALT) },
      requestedAt: { S: '2026-11-16T10:00:00.000Z#request-1' },
      application: { S: 'ApiKeyTest' },
      endpoint: { S: '/personen' },
      requestType: { S: 'RaadpleegMetBurgerservicenummer' },
      fields: { L: [{ S: 'naam' }] },
      bron: { S: 'verzoek' },
      gebruiker: { S: 'medewerker-1' },
      doelbinding: { S: 'BRPACT-Totaal' },
    });
    expect(items[1]).toMatchObject({ bsnHash: { S: AuditLog.hashBsn('999999333', SALT) }, bron: { S: 'verzoek' } });
  });

  it('logs only the returned persons when the response has BSNs', async () => {
    respondWith(200, { personen: [{ burgerservicenummer: '999971785' }] });

    await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['burgerservicenummer'],
      burgerservicenummer: ['999971785', '999999333'],
    }));

    expect(writtenItems().map(item => [item?.bsnHash.S, item?.bron.S])).toEqual([
      [AuditLog.hashBsn('999971785', SALT), 'antwoord'],
    ]);
  });

  it('logs the persons found by a search on other data', async () => {
    respondWith(200, { personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: '999999333' }] });

    await handler(createEvent(postcodeSearch(['burgerservicenummer', 'naam'])));

    expect(writtenItems().map(item => item?.bsnHash.S)).toEqual([
      AuditLog.hashBsn('999971785', SALT),
      AuditLog.hashBsn('999999333', SALT),
    ]);
  });

  it('writes no record for a search on other data without BSNs in the response', async () => {
    respondWith(200, { personen: [{ naam: { voornamen: 'A' } }] });

    const result = await handler(createEvent(postcodeSearch(['naam'])));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ personen: [{ naam: { voornamen: 'A' } }] });
    expect(writtenItems()).toHaveLength(0);
  });

  it('writes no record for a lookup by BSN that finds nobody', async () => {
    respondWith(200, { personen: [] });

    const result = await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['naam'],
      burgerservicenummer: ['999971785'],
    }));

    expect(result.statusCode).toBe(200);
    expect(writtenItems()).toHaveLength(0);
  });

  it('passes a Haal Centraal error on without writing a record', async () => {
    respondWith(400, { title: 'Bad request' });

    const result = await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['naam'],
      burgerservicenummer: ['999971785'],
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ title: 'Bad request' });
    expect(writtenItems()).toHaveLength(0);
  });

  it('returns 500 without person data when the record cannot be written', async () => {
    respondWith(200, { personen: [{ burgerservicenummer: '999971785', naam: { voornamen: 'A' } }] });
    ddbMock.on(BatchWriteItemCommand).rejects(new Error('DynamoDB down'));

    const result = await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['naam'],
      burgerservicenummer: ['999971785'],
    }));

    expect(result.statusCode).toBe(500);
    expect(result.body).not.toContain('voornamen');
  });

  it('does not call Haal Centraal or write a record when the profile does not allow the fields', async () => {
    const result = await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['geboorte'],
      burgerservicenummer: ['999971785'],
    }));

    expect(result.statusCode).toBe('403');
    expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    expect(writtenItems()).toHaveLength(0);
  });

  it('returns 400 when headers are missing and enforced', async () => {
    process.env.ENFORCE_AUDIT_LOG_HEADERS = 'true';

    const result = await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['naam'],
      burgerservicenummer: ['999971785'],
    }, { 'x-gebruiker': '' }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toContain('gebruiker');
    expect(mockCallHaalCentraal).not.toHaveBeenCalled();
  });

  it('logs onbekend when headers are missing and not enforced', async () => {
    respondWith(200, { personen: [{ burgerservicenummer: '999971785' }] });

    const result = await handler(createEvent({
      type: 'RaadpleegMetBurgerservicenummer',
      fields: ['naam'],
      burgerservicenummer: ['999971785'],
    }, { 'x-gebruiker': '', 'x-doelbinding': '' }));

    expect(result.statusCode).toBe(200);
    expect(writtenItems()[0]).toMatchObject({ gebruiker: { S: 'onbekend' }, doelbinding: { S: 'onbekend' } });
  });
});
