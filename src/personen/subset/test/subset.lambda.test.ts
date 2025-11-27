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
describe('should handle invalid BSN values', () => {
  const invalidBsnTestCases: [string, string | null | undefined][] = [
    ['empty string should be rejected', '' ],
    ['null value should be rejected', null],
    ['whitespace should be rejected', '   '],
    ['undefined should be rejected', undefined],
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
      expect(result.body).toBe('Missing x-bsn header');
      expect(result.headers['Content-Type']).toBe('text/plain');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    }
  );
});
});
