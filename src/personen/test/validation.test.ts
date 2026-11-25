import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import * as haal from '../callHaalCentraal';
import { handler } from '../personen.lambda'; // Handler import done later on to mock initSecrets
import { handler as handlerSubset } from '../subset/subset.lambda';
import { getApplicationProfile, validateFields } from '../validateFields';

jest.mock('node-fetch', () => jest.fn());
jest.mock('../initSecrets'); // Set mockResolve seperately to prevent unused import
jest.spyOn(haal, 'callHaalCentraal').mockResolvedValue({
  statusCode: 200,
  body: JSON.stringify({
    personen: [{ burgerservicenummer: '999971785', leeftijd: 37, kinderen: [{}], partners: [] }],
  }),
  headers: { 'Content-Type': 'application/json' },
});

const ddbMock = mockClient(DynamoDBClient);
const cloudWatchMock = mockClient(CloudWatchClient);

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

async function fixtureFingerprint(): Promise<string> {
  const { X509Certificate } = await import('crypto');
  return new X509Certificate(CLIENT_CERT_PEM).fingerprint256.replace(/:/g, '').toLowerCase();
}

beforeEach(() => {
  cloudWatchMock.reset();
  cloudWatchMock.on(PutMetricDataCommand).resolves({});
});


describe('validateFields', () => {
  it('should return true when all fields are allowed', async () => {
    const receivedFields = ['field1'];
    const result = validateFields(receivedFields, receivedFields);
    expect(result).toBe(true);
  });

  it('should return false when some fields are not allowed', async () => {
    const receivedFields = ['field3'];
    const profileFields = ['app-id-test'];
    const result = validateFields(receivedFields, profileFields);
    expect(result).toBe(false);
  });
});

describe('getAllowedFields', () => {

  it('should return allowed fields for a given API key', async () => {
    const apiKey = 'test-api-key';
    process.env.ID_TABLE_NAME = 'TestTable';
    setupGetItemResponse(['field1', 'field2'], 'test-api-key');
    const profile = await getApplicationProfile(apiKey);
    expect(profile.fields).toEqual(['field1', 'field2']);
  });

  it('should handle missing data gracefully', async () => {
    setupGetItemResponse(undefined, 'test-api-key');
    const apiKey = 'test-api-key';
    process.env.ID_TABLE_NAME = 'TestTable';
    const profile = getApplicationProfile(apiKey);
    await expect(profile).rejects.toThrow('Unknown application/profile');
  });

});

describe('handler', () => {

  it('should return 403 for invalid fields', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1'], 'app1');
    const event = {
      body: JSON.stringify({ fields: ['invalidField'] }),
      requestContext: { identity: { apiKey: 'test-api-key' } },
    } as any as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe('403');
    expect(result.body).toBe('Mismatch in application/profile');
  });

});

describe('handlersubset', () => {
// To ensure impact on subset by changes made in validation will get noticed due to failing tests

  it('should return 403 for invalid fields', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1'], 'app1');

    const event = {
      requestContext: { identity: { apiKey: 'test-api-key' } },
      resource: '/personen/burgerservicenummer/leeftijd',
      headers: { 'x-bsn': '999971785' },
    } as any as APIGatewayProxyEvent;

    const result = await handlerSubset(event);
    expect(result.statusCode).toBe(403);
    expect(result.body).toContain('Mismatch in application/profile for requested fields: burgerservicenummer, leeftijd');
  });

  it('should return 200 for valid fields', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'app1');

    const event = {
      requestContext: { identity: { apiKey: 'test-api-key' } },
      resource: '/personen/burgerservicenummer/leeftijd',
      headers: { 'x-bsn': '999971785' },
    } as any as APIGatewayProxyEvent;

    const result = await handlerSubset(event);
    expect(haal.callHaalCentraal).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'RaadpleegMetBurgerservicenummer',
        fields: ['burgerservicenummer', 'leeftijd'],
        burgerservicenummer: ['999971785'],
      }),
      undefined, // secrets
    );
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual(JSON.stringify({ leeftijd: 37 }));
  });


});

describe('log-only certificate binding (handler wiring)', () => {

  it('returns 200 for the personen handler and emits NO mismatch metric when the fingerprint matches', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    const fingerprint = await fixtureFingerprint();
    setupGetItemResponse(['field1'], 'app1', [fingerprint]);

    const event = {
      body: JSON.stringify({ fields: ['field1'] }),
      requestContext: { identity: { apiKey: 'test-api-key', apiKeyId: 'id', clientCert: { clientCertPem: CLIENT_CERT_PEM } } },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });

  it('still returns 200 (log-only) for the personen handler but emits a mismatch metric when the fingerprint does not match', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1'], 'app1', ['deadbeef']);

    const event = {
      body: JSON.stringify({ fields: ['field1'] }),
      requestContext: { identity: { apiKey: 'test-api-key', apiKeyId: 'id', clientCert: { clientCertPem: CLIENT_CERT_PEM } } },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    const calls = cloudWatchMock.commandCalls(PutMetricDataCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Namespace).toBe('CertificateBinding');
    expect(calls[0].args[0].input.MetricData?.[0].MetricName).toBe('CertificateBindingMismatch');
  });

  it('behaves exactly as today for the personen handler when no client cert is present', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1'], 'app1', ['deadbeef']);

    const event = {
      body: JSON.stringify({ fields: ['field1'] }),
      requestContext: { identity: { apiKey: 'test-api-key', apiKeyId: 'id' } },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event);
    // Request proceeds (log-only); missing cert still emits a mismatch metric.
    expect(result.statusCode).toBe(200);
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(1);
  });

  it('still returns 200 (log-only) for the subset handler when the fingerprint does not match', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['burgerservicenummer', 'leeftijd'], 'app1', ['deadbeef']);

    const event = {
      requestContext: { identity: { apiKey: 'test-api-key', apiKeyId: 'id', clientCert: { clientCertPem: CLIENT_CERT_PEM } } },
      resource: '/personen/burgerservicenummer/leeftijd',
      headers: { 'x-bsn': '999971785' },
    } as any as APIGatewayProxyEvent;

    const result = await handlerSubset(event);
    expect(result.statusCode).toBe(200);
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(1);
  });

});


function setupGetItemResponse(fields: string[] | undefined, name: string, fingerprints?: string[]) {
  let getItemOutput: Partial<GetItemCommandOutput> = {
    Item: undefined,
  };

  if (fields) {
    getItemOutput = {
      Item: {
        fields: {
          SS: fields,
        },
        name: {
          S: name,
        },
        ...(fingerprints ? { certFingerprintsSha256: { SS: fingerprints } } : {}),
      },
    };
  }

  ddbMock.on(GetItemCommand).resolves(getItemOutput);
}

