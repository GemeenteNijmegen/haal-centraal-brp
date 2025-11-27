import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { callHaalCentraal } from '../../callHaalCentraal';

const fakedInitSecrets = {
  certKey: 'test-cert-key',
  cert: 'test-cert',
  certCa: 'test-cert-ca',
  endpoint: 'https://test.endpoint',
  brpApiKey: 'test-brp-api-key',
};

const mockInitSecrets = jest.fn().mockResolvedValue(fakedInitSecrets);
jest.mock('../../initSecrets', () => ({
  initSecrets: mockInitSecrets,
}));

jest.mock('../../callHaalCentraal');
jest.mock('node-fetch', () => jest.fn());

// Handler mag pas geimporteerd worden na het neerzetten van de secrets. Die worden al opgehaald bij import.
import { handler } from '../subset.lambda';

const ddbMock = mockClient(DynamoDBClient);
const mockCallHaalCentraal = callHaalCentraal as jest.MockedFunction<
  typeof callHaalCentraal
>;

describe('subset handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    process.env.AWS_REGION = 'eu-central-1';
    process.env.ID_TABLE_NAME = 'TestTable';

    mockInitSecrets.mockClear();
    mockInitSecrets.mockResolvedValue(fakedInitSecrets);
  });

  const setupGetItemResponse = (fields?: string[], name?: string) => {
    const response = fields
      ? {
        Item: {
          fields: { SS: fields },
          name: { S: name || 'TestApp' },
        },
      }
      : { Item: undefined };
    ddbMock.on(GetItemCommand).resolves(response);
  };

  const createValidEvent = (bsn: string = '999971785') => ({
    requestContext: {
      identity: {
        apiKey: 'test-api-key',
        apiKeyId: 'test-api-key-id',
      },
    },
    headers: {
      'x-bsn': bsn,
    },
  });

  it('should debug secrets initialization after fix', async () => {
    setupGetItemResponse(['kinderen', 'leeftijd', 'partners'], 'TestApp');

    mockCallHaalCentraal.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        personen: [{ leeftijd: 35, kinderen: [], partners: [] }],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(
      'initSecrets mock calls before handler:',
      mockInitSecrets.mock.calls.length,
    );
    console.log('initSecrets mock results:', mockInitSecrets.mock.results);

    const event = createValidEvent();
    await handler(event);

    const calls = mockCallHaalCentraal.mock.calls;
    const secretsParam = calls[0][1];
    expect(secretsParam).not.toBeUndefined();
  });

  it('should successfully process valid request', async () => {
    setupGetItemResponse(['kinderen', 'leeftijd', 'partners'], 'UnitTestApp');

    mockCallHaalCentraal.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        personen: [
          {
            leeftijd: 35,
            kinderen: [{ naam: 'PietjePukDeDerde' }],
            partners: [],
          },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const event = createValidEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      leeftijd: 35,
      kinderen: true,
      partners: false,
    });

    expect(mockCallHaalCentraal).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'RaadpleegMetBurgerservicenummer',
        fields: ['kinderen', 'leeftijd', 'partners'],
        burgerservicenummer: ['999971785'],
      }),
      fakedInitSecrets,
    );
  });
  describe('should handle invalid and valid BSN values', () => {
    const invalidBsnTestCases: [string, string | null | undefined][] = [
      ['empty string should be rejected', ''],
      ['null value should be rejected', null],
      ['whitespace should be rejected', '   '],
      ['undefined should be rejected', undefined],
      ['BSN with letters should be rejected', '12345678a'],
      ['BSN with special characters should be rejected', '123-45-678'],
      ['BSN that fails checksum should be rejected', '123456789'],
    ];

    it.each(invalidBsnTestCases)(
      'should return 400 when x-bsn is %s',
      async (_description, value) => {
        setupGetItemResponse(['kinderen', 'leeftijd', 'partners'], 'UnitTestApp');

        const headers: any = {};
        headers['x-bsn'] = value;

        const event = {
          requestContext: {
            identity: {
              apiKey: 'test-api-key',
              apiKeyId: 'test-api-key-id',
            },
          },
          headers,
        };

        const result = await handler(event);

        expect(result.statusCode).toBe('400');
        expect(result.body).toContain('Invalid x-bsn header');
        expect(result.headers['Content-Type']).toBe('text/plain');
        expect(mockCallHaalCentraal).not.toHaveBeenCalled();
      },
    );

    const validBsnNumbers: [string, string][] = [
      ['valid BSN should be accepted', '999996708'],
      ['another valid BSN should be accepted', '999971785'],
    ];

    it.each(validBsnNumbers)(
      'should process request when %s',
      async (_description, validBsn) => {
        setupGetItemResponse(['kinderen', 'leeftijd', 'partners'], 'TestApp');

        mockCallHaalCentraal.mockResolvedValue({
          statusCode: 200,
          body: JSON.stringify({
            personen: [{ leeftijd: 35, kinderen: [], partners: [] }],
          }),
          headers: { 'Content-Type': 'application/json' },
        });

        const event = createValidEvent(validBsn);
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(mockCallHaalCentraal).toHaveBeenCalledWith(
          JSON.stringify({
            type: 'RaadpleegMetBurgerservicenummer',
            fields: ['kinderen', 'leeftijd', 'partners'],
            burgerservicenummer: [validBsn],
          }),
          fakedInitSecrets,
        );
      },
    );
  });

  describe('profile validation scenarios', () => {
    let consoleErrorSpy: jest.SpyInstance;
    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });
    it('should return 403 when getApplicationProfile throws error for unknown API key', async () => {
      setupGetItemResponse(); /// Zorg voor een error

      const event = createValidEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Internal Server Error');
      expect(result.headers['Content-Type']).toBe('text/plain');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });

    it('should return 403 when profile has insufficient fields', async () => {
      setupGetItemResponse(['leeftijd'], 'RestrictedApp');

      const event = createValidEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe('403');
      expect(result.body).toBe('Mismatch in application/profile for requested field kinderen,leeftijd,partners');
      expect(result.headers['Content-Type']).toBe('text/plain');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });

    it('should return 403 when profile has no overlapping fields', async () => {
      setupGetItemResponse(['naam', 'adres'], 'DifferentApp');

      const event = createValidEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe('403');
      expect(result.body).toBe('Mismatch in application/profile for requested field kinderen,leeftijd,partners');
      expect(result.headers['Content-Type']).toBe('text/plain');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });
  });

  describe('callHaalCentraal error handling', () => {
    let consoleErrorSpy: jest.SpyInstance;
    beforeEach(() => {
      setupGetItemResponse(['kinderen', 'leeftijd', 'partners'], 'TestApp');
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('should return 500 when callHaalCentraal throws network error', async () => {
      mockCallHaalCentraal.mockRejectedValue(new Error('Network timeout'));

      const event = createValidEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Internal Server Error');
      expect(result.headers['Content-Type']).toBe('text/plain');
    });

    it('should return 500 when callHaalCentraal returns invalid JSON', async () => {
      mockCallHaalCentraal.mockResolvedValue({
        statusCode: 200,
        body: 'invalid json response',
        headers: { 'Content-Type': 'application/json' },
      });

      const event = createValidEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(result.body).toBe('Internal Server Error');
      expect(result.headers['Content-Type']).toBe('text/plain');
    });
  });

  describe('response transformation leeftijd partner kinderen cases', () => {
    beforeEach(() => {
      setupGetItemResponse(['kinderen', 'leeftijd', 'partners'], 'TestApp');
    });

    const personDataTestCases: [string, any, any][] = [
      [
        'person with missing kinderen property',
        { leeftijd: 30, partners: [] },
        { leeftijd: 30, kinderen: false, partners: false },
      ],
      [
        'person with missing partners property',
        { leeftijd: 40, kinderen: [] },
        { leeftijd: 40, kinderen: false, partners: false },
      ],
      [
        'person with null kinderen',
        { leeftijd: 50, kinderen: null, partners: [] },
        { leeftijd: 50, kinderen: false, partners: false },
      ],
      [
        'person with null partners',
        { leeftijd: 60, kinderen: [], partners: null },
        { leeftijd: 60, kinderen: false, partners: false },
      ],
      [
        'person with multiple children and partners',
        {
          leeftijd: 45,
          kinderen: [{ naam: 'Kind1' }, { naam: 'Kind2' }],
          partners: [{ naam: 'Partner1' }, { naam: 'Partner2' }],
        },
        { leeftijd: 45, kinderen: true, partners: true },
      ],
    ];

    it.each(personDataTestCases)(
      'should correctly transform %s',
      async (_description, personData, expectedResponse) => {
        mockCallHaalCentraal.mockResolvedValue({
          statusCode: 200,
          body: JSON.stringify({ personen: [personData] }),
          headers: { 'Content-Type': 'application/json' },
        });

        const event = createValidEvent();
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual(expectedResponse);
        expect(result.headers['Content-Type']).toBe('application/json');
      },
    );
  });

});
