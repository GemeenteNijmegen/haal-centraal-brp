import * as crypto from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';
import {
  checkCertificateBinding,
  computeClientCertFingerprint,
  extractClientCertPem,
  normalizeFingerprint,
} from '../certBinding';

const cloudWatchMock = mockClient(CloudWatchClient);

// A static, parseable self-signed certificate used as a fixture.
const STATIC_PEM = `-----BEGIN CERTIFICATE-----
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

describe('normalizeFingerprint', () => {
  it('strips colons and lowercases', () => {
    expect(normalizeFingerprint('AB:CD:EF:12')).toBe('abcdef12');
  });
});

describe('extractClientCertPem', () => {
  it('returns the PEM when present on the event', () => {
    const event = { requestContext: { identity: { clientCert: { clientCertPem: 'the-pem' } } } };
    expect(extractClientCertPem(event)).toBe('the-pem');
  });

  it('returns undefined when the client cert is absent', () => {
    expect(extractClientCertPem({ requestContext: { identity: {} } })).toBeUndefined();
    expect(extractClientCertPem({})).toBeUndefined();
    expect(extractClientCertPem(undefined)).toBeUndefined();
  });
});

describe('computeClientCertFingerprint', () => {
  it('returns a lowercase, colon-free hex fingerprint for a valid PEM', () => {
    const result = computeClientCertFingerprint(STATIC_PEM);
    const expected = normalizeFingerprint(new crypto.X509Certificate(STATIC_PEM).fingerprint256);
    expect(result).toBe(expected);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('returns undefined for a missing/empty PEM', () => {
    expect(computeClientCertFingerprint(undefined)).toBeUndefined();
    expect(computeClientCertFingerprint('')).toBeUndefined();
  });

  it('returns undefined for an unparseable PEM without throwing', () => {
    expect(() => computeClientCertFingerprint('not a certificate')).not.toThrow();
    expect(computeClientCertFingerprint('not a certificate')).toBeUndefined();
  });
});

describe('checkCertificateBinding', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    cloudWatchMock.reset();
    cloudWatchMock.on(PutMetricDataCommand).resolves({});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns true and emits no mismatch metric when the fingerprint matches (tolerant of colons/case)', async () => {
    const fingerprint = 'abcdef1234567890';
    const result = await checkCertificateBinding({
      fingerprint,
      allowedFingerprints: ['AB:CD:EF:12:34:56:78:90'],
      profileName: 'TestApp',
      apiKeyId: 'key-id',
    });

    expect(result).toBe(true);
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false, logs a warning and emits a metric on mismatch without throwing', async () => {
    const result = await checkCertificateBinding({
      fingerprint: 'aaaa',
      allowedFingerprints: ['bbbb'],
      profileName: 'TestApp',
      apiKeyId: 'key-id',
    });

    expect(result).toBe(false);
    const calls = cloudWatchMock.commandCalls(PutMetricDataCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.Namespace).toBe('CertificateBinding');
    expect(input.MetricData?.[0].MetricName).toBe('CertificateBindingMismatch');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Never log the raw API key value.
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toContain('key-id-secret');
  });

  it('returns false and emits a metric when the fingerprint is missing', async () => {
    const result = await checkCertificateBinding({
      fingerprint: undefined,
      allowedFingerprints: ['bbbb'],
      profileName: 'TestApp',
      apiKeyId: 'key-id',
    });

    expect(result).toBe(false);
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(1);
  });

  it('returns false and emits a metric when the allowed set is empty', async () => {
    const result = await checkCertificateBinding({
      fingerprint: 'aaaa',
      allowedFingerprints: [],
      profileName: 'TestApp',
      apiKeyId: 'key-id',
    });

    expect(result).toBe(false);
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(1);
  });

  it('does not throw when the metric emission fails', async () => {
    cloudWatchMock.on(PutMetricDataCommand).rejects(new Error('CloudWatch down'));

    await expect(
      checkCertificateBinding({
        fingerprint: 'aaaa',
        allowedFingerprints: ['bbbb'],
        profileName: 'TestApp',
        apiKeyId: 'key-id',
      }),
    ).resolves.toBe(false);
  });
});
