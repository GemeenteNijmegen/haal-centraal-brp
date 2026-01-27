import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../certmetrics.lambda';

const s3Mock = mockClient(S3Client);
const cloudWatchMock = mockClient(CloudWatchClient);

// Mock certificate content (valid certificate)
const mockCertificate = `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAKoK/heBjcOuMA0GCSqGSIb3DQEBBQUAMEUxCzAJBgNV
BAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX
aWRnaXRzIFB0eSBMdGQwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjBF
MQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50
ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB
CgKCAQEAuuExKvY+DXgH1proTtmPx24+RnLZo7fcqLUKcp2+ugRbHbD6yuqXyBPa
D/9xnGN0/G1KI4XF4FHcSWbfCEh4HllG2v4RuY6HFRdOwAmJsMx5PcYDlbEysdHy
3/w9iY0vMpNZ4e7sGxnHQQ1radNlG7f+1l3ganP0C/YyKBXOr9qpXGM5+b5Dk6Hi
jYxMHhyDrDQKjXvS7/pzjPx3d8g7PiHZ4dNP1YMdJGNQrfGz7A0VxRVzMpVQrBpU
nAjZpMYoArC6ditSKdnB9u05mLMjgNBhHI8pjObP+SGBn1l1TogGc0tpKhRgHtfn
+CcE+s3tfPv6wnqRfEcw+qy+KQIDAQABo1AwTjAdBgNVHQ4EFgQUhBjMhTTsvAyU
lC4IWZzHshBOCggwHwYDVR0jBBgwFoAUhBjMhTTsvAyUlC4IWZzHshBOCggwDAYD
VR0TBAUwAwEB/zANBgkqhkiG9w0BAQUFAAOCAQEAtKuQ4lTLhE+oJ4+ucrTKlBqV
N6w2RDdwi+3W8KfnzOlZMlsIT9987un7lUx9+ZOOyXBgLovQXcab4HRg38daimjr
Wj6DDYq02OuDqiIBqQCcaS2aJ4jg8/qnpohfh2VmmjiQzBn4q7L8wDJfEFp+LvYv
+RJZG4l2itz0Z4k+nnxvomEHM6+ZlATkjn8t3iDQGcgwU+oHxtVMrXLKjmwrISTK
jB+Rjbqg+P+NjK1qkBuDfVrNDLO+DdWMhVqUmZeF1PpVMRQX8Pyq93G0D4r+8rUt
nwf+J5u6eqZjTrTJ+jwg1ivQeuDfL+L1zxz8sQrEXtdPuF3Q==
-----END CERTIFICATE-----`;

describe('CertMetrics Lambda', () => {
  beforeEach(() => {
    s3Mock.reset();
    cloudWatchMock.reset();
    process.env.CERT_BUCKET_NAME = 'test-cert-bucket';
  });

  afterEach(() => {
    delete process.env.CERT_BUCKET_NAME;
  });

  it('should process certificates and send metrics successfully', async () => {
    // Mock S3 responses
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'cert1.pem' },
        { Key: 'cert2.pem' },
      ],
    });

    s3Mock.on(GetObjectCommand).resolves({
      Body: {
        transformToString: async () => mockCertificate,
      } as any,
    });

    // Mock CloudWatch response
    cloudWatchMock.on(PutMetricDataCommand).resolves({});

    const result = await handler({});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Certificate metrics processed successfully');
    expect(body.certificatesProcessed).toBe(2);

    // Verify S3 calls
    expect(s3Mock.commandCalls(ListObjectsV2Command)).toHaveLength(1);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(2);

    // Verify CloudWatch calls (should be called for metrics)
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand).length).toBeGreaterThan(0);
  });

  it('should handle empty certificate bucket', async () => {
    // Mock empty S3 response
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
    });

    const result = await handler({});

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.certificatesProcessed).toBe(0);

    // Verify no CloudWatch calls for empty bucket
    expect(cloudWatchMock.commandCalls(PutMetricDataCommand)).toHaveLength(0);
  });

  it('should handle S3 errors gracefully', async () => {
    // Mock S3 error
    s3Mock.on(ListObjectsV2Command).rejects(new Error('S3 Error'));

    await expect(handler({})).rejects.toThrow('Error processing certificate metrics');
  });
});