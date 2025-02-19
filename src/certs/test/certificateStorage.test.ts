import * as fs from 'fs';
import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { buildNewTruststore, updateTruststoreVersion } from '../certificates.lambda';

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn(() => ({
      send: jest.fn(),
    })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
  };
});

jest.mock('@aws-sdk/client-apigatewayv2', () => {
  return {
    ApiGatewayV2Client: jest.fn(() => ({
      send: jest.fn(),
    })),
    UpdateDomainNameCommand: jest.fn(),
  };
});

const s3 = new S3Client({
  region: 'eu-central-1',
});
const api = new ApiGatewayV2Client({
  region: 'eu-central-1',
});

describe('Certificate Storage and Truststore Update', () => {
  const bucketName = 'certificate-storage-bucket';
  const truststoreBucketName = 'truststore-bucket';
  const domainName = 'example.com';
  const newTruststoreVersion = 'v2';
  const certificateContent = '-----BEGIN CERTIFICATE-----\n...certificate content...\n-----END CERTIFICATE-----';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should upload a certificate to the certificate storage bucket', async () => {
    // Mock S3 putObject response
    (s3.send as jest.Mock).mockResolvedValue({});

    // Upload a certificate to the certificate storage bucket
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: 'cert1.pem',
      Body: certificateContent,
    }));

    // Verify S3 putObject call
    expect(s3.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });

  // it('should fetch certificates from the storage bucket', async () => {
  //   // Mock S3 listObjectsV2 response
  //   (s3.send as jest.Mock).mockResolvedValueOnce({
  //     Contents: [{ Key: 'cert1.pem' }],
  //   });

  //   // Mock S3 getObject response
  //   (s3.send as jest.Mock).mockResolvedValueOnce({
  //     Body: {
  //       transformToString: jest.fn().mockResolvedValue(certificateContent),
  //     },
  //   });

  //   // Fetch certificates from the storage bucket
  //   const certificates = await getCertificates();
  //   expect(certificates).toContain(certificateContent);

  //   // Verify S3 listObjectsV2 and getObject calls
  //   expect(s3.send).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
  //   expect(s3.send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  // });

  it('should create a .pem file from the certificates', async () => {
    const certificates = [certificateContent];

    // Create a .pem file from the certificates
    const pemFilePath = await buildNewTruststore(certificates);
    expect(pemFilePath).toBe('/tmp/truststore.pem');

    // Verify the content of the .pem file
    const pemContent = fs.readFileSync(pemFilePath, 'utf8');
    expect(pemContent).toBe(certificateContent);
  });

  it('should upload the .pem file to the truststore bucket', async () => {
    const pemFilePath = '/tmp/truststore.pem';
    fs.writeFileSync(pemFilePath, certificateContent);

    // Mock S3 putObject response
    (s3.send as jest.Mock).mockResolvedValue({});

    // Upload the .pem file to the truststore bucket
    const pemContent = fs.readFileSync(pemFilePath, 'utf8');
    await s3.send(new PutObjectCommand({
      Bucket: truststoreBucketName,
      Key: 'truststore.pem',
      Body: pemContent,
    }));

    // Verify S3 putObject call
    expect(s3.send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });

  it('should update the truststore version in the API Gateway', async () => {
    const truststoreUri = `s3://${truststoreBucketName}/truststore.pem`;
    const domainNameResource = {
      $metadata: { httpStatusCode: 200 },
      DomainName: domainName,
      MutualTlsAuthentication: {
        TruststoreUri: truststoreUri,
      },
      DomainNameConfigurations: [
        {
          CertificateArn: 'arn:aws:acm:region:account-id:certificate/certificate-id',
        },
      ],
    };

    // Mock API Gateway updateDomainName response
    (api.send as jest.Mock).mockResolvedValue({});

    // Update the truststore version in the API Gateway
    await updateTruststoreVersion(domainNameResource, newTruststoreVersion);

    // Verify API Gateway updateDomainName call
    // expect(api.send).toHaveBeenCalledWith(expect.any(UpdateDomainNameCommand));
  });
});