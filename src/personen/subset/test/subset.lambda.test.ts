import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { callHaalCentraal } from '../../callHaalCentraal';
import { SubsetHandlerFactory } from '../handlers/subset-handler-factory';

const fakedInitSecrets = {
  certKey: 'test-cert-key',
  cert: 'test-cert',
  certCa: 'test-cert-ca',
  endpoint: 'https://test.endpoint',
  brpApiKey: 'test-brp-api-key',
};

jest.mock('../../initSecrets', () => ({
  initSecrets: jest.fn(() => Promise.resolve(fakedInitSecrets)),
}));

jest.mock('../../callHaalCentraal');
jest.mock('node-fetch', () => jest.fn());

import { handler } from '../subset.lambda';


const ddbMock = mockClient(DynamoDBClient);
const cloudWatchMock = mockClient(CloudWatchClient);
const mockCallHaalCentraal = callHaalCentraal as jest.MockedFunction<typeof callHaalCentraal>;

// A static, parseable self-signed client certificate used as a fixture for binding tests.
const CLIENT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIUGSRJLUIz9VWbY26uL618k1maSBwwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLdGVzdC1jbGllbnQwHhcNMjYxMDEyMTIxNTI4WhcNMzYx
MDA5MTIxNTI4WjAWMRQwEgYDVQQDDAt0ZXN0LWNsaWVudDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAMvg23GfDNF33etNHOtLnU+gENPWwEPWmNQcw2hq
5msF4XOjYx7gmy6u+2P+uFAimbkei30HCy25o5H2hmf45ha95pb6TeLIK208MFCq
MSP5DF7CF1LaUdc1g1HLKsDleRVANpIE6pabYwn8a6rbPUXh/kQEqdV6qdqU101v
fcroy3Ufleh3vZmEhGMrEqqQywQmDMNgO5Bsjq+zV1Z3obAFWlGucRsE12KslBq/
x+OvkSfLFJz+tg92MNmLFsTKuJbqwygMu0M/HdNKKZmppwvVLCZvhGqp8TIufnOI
oqD4ovCBexag02+C46SvIfVm4NfyAnpIR2QhoxmpLGqX1ZkCAwEAAaNTMFEwHQYD
VR0OBBYEFDRfpBb5gCKO1POzcJvUFXw4WG88MB8GA1UdIwQYMBaAFDRfpBb5gCKO
1POzcJvUFXw4WG88MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AH5cm6CK8Wl1Q/lt/uGHlqou3lpObEXiFG4OPX+fJpRdRpNSzWyjt5a+hIanWVjH
jb8NHHN4NBLcR/+mcX4s4o16EJmI+UTSZP3xDtWxSyF1O4r252The6pax9YC9e/v
srv9PZ68DKshcMkBI7WlyZdoNmeWveBLz8BFGDgloWbKm3eQ8TOpj0idLWz4ZIRr
klEJejj99cHJbo8GHeY3rBmchZbazTI3iAv25p/VefQBVV67trKphErybZbMpITL
1agJiJpzNiAKKjN3NNpIrrNJot/jzV59RHFHGC3D0fjOLvXEade0iYJ9YWlywyH+
bO8VLM0MS4/xQwZvNILtaBA=
-----END CERTIFICATE-----`;

describe('subset lambda handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    cloudWatchMock.reset();
    cloudWatchMock.on(PutMetricDataCommand).resolves({});
    SubsetHandlerFactory.clearCache();

    process.env.AWS_REGION = 'eu-central-1';
    process.env.ID_TABLE_NAME = 'TestTable';
  });

  // Validatefields dynamodb helper
  const setupGetItemResponse = (fields?: string[], name?: string, fingerprints?: string[]) => {
    const response = fields
      ? {
        Item: {
          fields: { SS: fields },
          name: { S: name || 'ApiKeyTest' },
          ...(fingerprints ? { certFingerprintsSha256: { SS: fingerprints } } : {}),
        },
      }
      : { Item: undefined };
    ddbMock.on(GetItemCommand).resolves(response);
  };

  interface CreateEventOptions {
    bsn?: string;
    resource?: string;
    apiKey?: string;
    apiKeyId?: string;
    clientCertPem?: string;
  }

  // Event helper
  const createValidEvent = (options: CreateEventOptions = {}): APIGatewayProxyEvent => {
    const {
      resource = '/personen/burgerservicenummer/leeftijd',
      apiKey = 'test-api-key',
      apiKeyId = 'test-api-key-id',
      clientCertPem,
    } = options;

    const headers: any = {};
    if ('bsn' in options && options.bsn !== undefined) {
      headers['x-bsn'] = options.bsn;
    } else if (!('bsn' in options)) {
      headers['x-bsn'] = '999971785'; // Default alleen als bsn niet is meegegeven
    }
    return {
      requestContext: {
        identity: {
          apiKey,
          apiKeyId,
          ...(clientCertPem ? { clientCert: { clientCertPem } } : {}),
        },
      } as any,
      headers,
      resource,
    } as any as APIGatewayProxyEvent;
  };

  interface MockHaalCentraalOptions {
    statusCode?: number;
    personData?: any;
    headers?: Record<string, string>;
  }

  // Haal Centraal mock helper
  const setupHaalCentraalResponse = (options: MockHaalCentraalOptions = {}) => {
    const statusCode = options.statusCode ?? 200;
    const personData = options.personData ?? {
      burgerservicenummer: '999971785',
      leeftijd: 35,
    };
    const headers = options.headers as any ?? { 'Content-Type': 'application/json' };

    mockCallHaalCentraal.mockResolvedValue({
      statusCode,
      body: JSON.stringify({
        personen: [personData],
      }),
      headers,
    });
  };

  it('should verify mock setup works', async () => {
    setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
    setupHaalCentraalResponse();

    const event = createValidEvent();
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockCallHaalCentraal).toHaveBeenCalledWith(
      expect.stringContaining('RaadpleegMetBurgerservicenummer'),
      fakedInitSecrets,
    );
  });

  describe('Happy flow per endpoint', () => {
    describe('leeftijd endpoint', () => {
      it('should successfully process leeftijd request', async () => {
        setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
        setupHaalCentraalResponse({
          personData: {
            burgerservicenummer: '999971785',
            leeftijd: 42,
          },
        });

        const event = createValidEvent({ resource: '/personen/burgerservicenummer/leeftijd' });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({
          leeftijd: 42,
        });
        expect(mockCallHaalCentraal).toHaveBeenCalledWith(
          expect.stringContaining('burgerservicenummer'),
          fakedInitSecrets,
        );
      });
    });

    describe('kinderen-partners endpoint', () => {
      it('should successfully process kinderen-partners request with both present', async () => {
        setupGetItemResponse(['burgerservicenummer', 'kinderen', 'partners'], 'ApiKeyTest');
        setupHaalCentraalResponse({
          personData: {
            burgerservicenummer: '999971785',
            kinderen: [{ burgerservicenummer: '123456789' }],
            partners: [{ burgerservicenummer: '987654321' }],
          },
        });

        const event = createValidEvent({ resource: '/personen/burgerservicenummer/kinderen-partners' });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({
          kinderen: true,
          partners: true,
        });
      });

      it('should successfully process kinderen-partners request with empty arrays', async () => {
        setupGetItemResponse(['burgerservicenummer', 'kinderen', 'partners'], 'ApiKeyTest');
        setupHaalCentraalResponse({
          personData: {
            burgerservicenummer: '999971785',
            kinderen: [],
            partners: [],
          },
        });

        const event = createValidEvent({ resource: '/personen/burgerservicenummer/kinderen-partners' });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({
          kinderen: false,
          partners: false,
        });
      });
    });

    describe('nederlands endpoint', () => {
      it('should successfully process nederlands request when Nederlandse nationaliteit present', async () => {
        setupGetItemResponse(['burgerservicenummer', 'nationaliteiten'], 'ApiKeyTest');
        setupHaalCentraalResponse({
          personData: {
            burgerservicenummer: '999971785',
            nationaliteiten: [
              {
                nationaliteit: {
                  code: '0001',
                  omschrijving: 'Nederlandse',
                },
              },
            ],
          },
        });

        const event = createValidEvent({ resource: '/personen/burgerservicenummer/nederlands' });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({
          nederlands: true,
        });
      });

      it('should successfully process nederlands request when no Nederlandse nationaliteit', async () => {
        setupGetItemResponse(['burgerservicenummer', 'nationaliteiten'], 'ApiKeyTest');
        setupHaalCentraalResponse({
          personData: {
            burgerservicenummer: '999971785',
            nationaliteiten: [
              {
                nationaliteit: {
                  code: '0027',
                  omschrijving: 'Belgische',
                },
              },
            ],
          },
        });

        const event = createValidEvent({ resource: '/personen/burgerservicenummer/nederlands' });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual({
          nederlands: false,
        });
      });
    });
  });


  describe('BSN validation', () => {
    describe('should reject invalid BSN values', () => {
      const invalidBsnTestCases: [string, string | null | undefined][] = [
        ['empty string', ''],
        ['null value', null],
        ['whitespace only', '   '],
        ['undefined value', undefined],
        ['BSN with letters', '12345678a'],
        ['BSN with special characters', '123-45-678'],
        ['BSN that fails checksum', '123456789'],
      ];

      it.each(invalidBsnTestCases)(
        'should return 400 when x-bsn is %s',
        async (_description, bsnValue) => {
          setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');

          const event = createValidEvent({ bsn: bsnValue as any });
          const result = await handler(event);

          expect(result.statusCode).toBe(400);
          expect(result.body).toContain('BSN');
          expect(result.headers!['Content-Type']).toBe('application/json');
          expect(mockCallHaalCentraal).not.toHaveBeenCalled();
        },
      );
    });

    describe('should accept valid BSN values', () => {
      const validBsnTestCases: [string, string][] = [
        ['valid BSN 999996708', '999996708'],
        ['valid BSN 999971785', '999971785'],
      ];

      it.each(validBsnTestCases)(
        'should process request when %s',
        async (_description, validBsn) => {
          setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
          setupHaalCentraalResponse({
            personData: {
              burgerservicenummer: validBsn,
              leeftijd: 35,
            },
          });

          const event = createValidEvent({ bsn: validBsn });
          const result = await handler(event);

          expect(result.statusCode).toBe(200);
          expect(mockCallHaalCentraal).toHaveBeenCalledWith(
            expect.stringContaining(validBsn),
            fakedInitSecrets,
          );
        },
      );
    });

    it('should return 400 when x-bsn header is missing', async () => {
      setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');

      const event = createValidEvent({ bsn: undefined });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(result.body).toContain('BSN header is missing');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });
  });

  describe('Profile validation', () => {
    it('should return 500 when API key not found in DynamoDB', async () => {
      setupGetItemResponse();

      const event = createValidEvent({ resource: '/personen/burgerservicenummer/leeftijd' });
      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      expect(result.body).toContain('Internal server error');
      expect(result.headers!['Content-Type']).toBe('application/json');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });

    it('should return 403 when profile has insufficient fields', async () => {
      setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');

      const event = createValidEvent({ resource: '/personen/burgerservicenummer/kinderen-partners' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(result.body).toContain('Mismatch in application/profile');
      expect(result.body).toContain('kinderen');
      expect(result.body).toContain('partners');
      expect(result.headers!['Content-Type']).toBe('application/json');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });

    it('should return 403 when profile has no overlapping fields', async () => {
      setupGetItemResponse(['burgerservicenummer', 'naam', 'adres'], 'ApiKeyTest');

      const event = createValidEvent({ resource: '/personen/burgerservicenummer/leeftijd' });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(result.body).toContain('Mismatch in application/profile');
      expect(result.body).toContain('leeftijd');
      expect(result.headers!['Content-Type']).toBe('application/json');
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });

    it('should succeed when profile has exact required fields', async () => {
      setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
      setupHaalCentraalResponse({
        personData: {
          burgerservicenummer: '999971785',
          leeftijd: 35,
        },
      });

      const event = createValidEvent({ resource: '/personen/burgerservicenummer/leeftijd' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(mockCallHaalCentraal).toHaveBeenCalled();
    });

    it('should succeed when profile has more fields than required', async () => {
      setupGetItemResponse(
        ['burgerservicenummer', 'leeftijd', 'naam', 'adres', 'nationaliteiten'],
        'ApiKeyTest',
      );
      setupHaalCentraalResponse({
        personData: {
          burgerservicenummer: '999971785',
          leeftijd: 42,
        },
      });

      const event = createValidEvent({ resource: '/personen/burgerservicenummer/leeftijd' });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        leeftijd: 42,
      });
      expect(mockCallHaalCentraal).toHaveBeenCalled();
    });

    describe('should validate fields per endpoint', () => {
      const endpointFieldTests: [string, string, string[]][] = [
        ['leeftijd', '/personen/burgerservicenummer/leeftijd', ['burgerservicenummer', 'leeftijd']],
        [
          'kinderen-partners',
          '/personen/burgerservicenummer/kinderen-partners',
          ['burgerservicenummer', 'kinderen', 'partners'],
        ],
        ['nederlands', '/personen/burgerservicenummer/nederlands', ['burgerservicenummer', 'nationaliteiten']],
      ];

      it.each(endpointFieldTests)(
        'should succeed for %s endpoint with correct fields',
        async (_description, resource, fields) => {
          setupGetItemResponse(fields, 'ApiKeyTest');
          setupHaalCentraalResponse();

          const event = createValidEvent({ resource });
          const result = await handler(event);

          expect(result.statusCode).toBe(200);
          expect(mockCallHaalCentraal).toHaveBeenCalled();
        },
      );

      it.each(endpointFieldTests)(
        'should fail for %s endpoint when missing required fields',
        async (_description, resource, requiredFields) => {
          const insufficientFields = requiredFields.slice(0, 1);
          setupGetItemResponse(insufficientFields, 'ApiKeyTest');

          const event = createValidEvent({ resource });
          const result = await handler(event);

          expect(result.statusCode).toBe(403);
          expect(result.body).toContain('Mismatch in application/profile');
          expect(mockCallHaalCentraal).not.toHaveBeenCalled();
        },
      );
    });
  });

  describe('Endpoint and resource validation', () => {
    describe('should reject invalid resource paths', () => {
      const invalidResourceTests: [string, string, number, string][] = [
        ['unknown endpoint', '/personen/burgerservicenummer/onbekend-endpoint', 404, 'Endpoint not found'],
        ['invalid path format', '/invalid-path', 400, 'Invalid resource path'],
        ['empty resource', '', 404, 'no endpoint found'],
        ['only base path', '/personen/burgerservicenummer', 400, 'Invalid resource path'],
      ];

      it.each(invalidResourceTests)(
        'should return error when %s',
        async (_description, resource, expectedStatus, expectedMessage) => {
          setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');

          const event = createValidEvent({ resource: resource as any });
          const result = await handler(event);

          expect(result.statusCode).toBe(expectedStatus);
          expect(result.body).toContain(expectedMessage);
          expect(result.headers!['Content-Type']).toBe('application/json');
          expect(mockCallHaalCentraal).not.toHaveBeenCalled();
        },
      );
    });
  });


  describe('Haal Centraal error scenarios', () => {
    describe('should handle callHaalCentraal errors', () => {
      let consoleErrorSpy: jest.SpyInstance;

      beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
      });

      afterEach(() => {
        consoleErrorSpy.mockRestore();
      });

      it('should return 500 when callHaalCentraal throws network error', async () => {
        mockCallHaalCentraal.mockRejectedValue(new Error('Network timeout'));

        const event = createValidEvent();
        const result = await handler(event);

        expect(result.statusCode).toBe(500);
        expect(result.body).toContain('Internal server error');
        expect(result.headers!['Content-Type']).toBe('application/json');
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
        expect(result.body).toContain('Internal server error');
        expect(result.headers!['Content-Type']).toBe('application/json');
      });
    });

    describe('should handle missing or invalid person data in response', () => {
      const missingDataTestCases: [string, any][] = [
        ['missing personen array', {}],
        ['null personen', { personen: null }],
        ['empty personen array', { personen: [] }],
        ['persoon without burgerservicenummer', { personen: [{ leeftijd: 35 }] }],
        ['persoon with null burgerservicenummer', { personen: [{ burgerservicenummer: null, leeftijd: 35 }] }],
      ];

      it.each(missingDataTestCases)(
        'should return 404 when response has %s',
        async (_description, responseData) => {
          setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
          mockCallHaalCentraal.mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify(responseData),
            headers: { 'Content-Type': 'application/json' },
          });

          const event = createValidEvent();
          const result = await handler(event);

          expect(result.statusCode).toBe(404);
          expect(result.body).toContain('No person found in responsebody');
          expect(result.headers!['Content-Type']).toBe('application/json');
        },
      );
    });

    describe('should handle non-200 status codes from Haal Centraal', () => {
      const nonSuccessStatusCodes: [number, string][] = [
        [400, 'Bad Request'],
        [401, 'Unauthorized'],
        [403, 'Forbidden'],
        [404, 'Not Found'],
        [500, 'Internal Server Error'],
        [503, 'Service Unavailable'],
      ];

      it.each(nonSuccessStatusCodes)(
        'should return %s when Haal Centraal returns %s',
        async (statusCode) => {
          setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest');
          mockCallHaalCentraal.mockResolvedValue({
            statusCode,
            body: JSON.stringify({ error: 'Error from Haal Centraal' }),
            headers: { 'Content-Type': 'application/json' },
          });

          const event = createValidEvent();
          const result = await handler(event);

          expect(result.statusCode).toBe(statusCode);
          expect(result.body).toContain('- HaalCentraal error');
          expect(result.headers!['Content-Type']).toBe('application/json');
        },
      );
    });
  });

  describe('log-only certificate binding', () => {
    const fixtureFingerprint = async (): Promise<string> => {
      const { X509Certificate } = await import('crypto');
      return new X509Certificate(CLIENT_CERT_PEM).fingerprint256.replace(/:/g, '').toLowerCase();
    };

    it('still returns 200 and emits NO mismatch metric when the fingerprint matches', async () => {
      const fingerprint = await fixtureFingerprint();
      setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest', [fingerprint]);
      setupHaalCentraalResponse();

      const event = createValidEvent({ clientCertPem: CLIENT_CERT_PEM });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
    });

    it('still returns 200 (log-only) and emits a mismatch metric when the fingerprint does not match', async () => {
      setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest', ['deadbeef']);
      setupHaalCentraalResponse();

      const event = createValidEvent({ clientCertPem: CLIENT_CERT_PEM });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const calls = cloudWatchMock.commandCalls(PutMetricDataCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.Namespace).toBe('CertificateBinding');
      expect(calls[0].args[0].input.MetricData?.[0].MetricName).toBe('CertificateBindingMismatch');
    });

    it('behaves exactly as today when no client cert is present', async () => {
      setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'ApiKeyTest', ['deadbeef']);
      setupHaalCentraalResponse();

      const event = createValidEvent();
      const result = await handler(event);

      // Request proceeds (log-only); missing cert still emits a mismatch metric.
      expect(result.statusCode).toBe(200);
      expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(1);
    });
  });

});