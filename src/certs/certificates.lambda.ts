import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ApiGatewayV2Client, GetDomainNameCommand, GetDomainNameCommandOutput, UpdateDomainNameCommand } from '@aws-sdk/client-apigatewayv2';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

const api = new ApiGatewayV2Client({ region: 'eu-central-1' });
const s3client = new S3Client({ region: 'eu-central-1' });
const cloudwatch = new CloudWatchClient({ region: 'eu-central-1' });
const bucketName = process.env.CERT_BUCKET_NAME ?? '';
const truststoreBucketName = process.env.TRUSTSTORE_BUCKET_NAME ?? '';
const domainName = process.env.CUSTOM_DOMAIN_NAME ?? '';

interface CertificateInfo {
  content: string;
  key: string;
  isValid: boolean;
  expirationDate: Date;
  daysUntilExpiration: number;
  subject: string;
  issuer: string;
}

export async function handler(event: any): Promise<any> {
  console.log('Updating truststore...');
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const certificateInfos = await getCertificatesWithValidation();
    console.log('Received and validated certificates');

    // Send certificate expiration metrics to CloudWatch
    await sendCertificateMetrics(certificateInfos);
    console.log('Certificate metrics sent to CloudWatch');

    // Filter out expired certificates and log warnings
    const validCertificates = certificateInfos
      .filter(cert => {
        if (!cert.isValid) {
          console.warn(`Certificate ${cert.key} is expired or invalid. Subject: ${cert.subject}, Expiration: ${cert.expirationDate}`);
          return false;
        }
        if (cert.daysUntilExpiration <= 30) {
          console.warn(`Certificate ${cert.key} expires in ${cert.daysUntilExpiration} days. Subject: ${cert.subject}, Expiration: ${cert.expirationDate}`);
        }
        return true;
      })
      .map(cert => cert.content);

    if (validCertificates.length === 0) {
      throw new Error('No valid certificates found');
    }

    const pemFilePath = await buildNewTruststore(validCertificates);
    console.log('New truststore built with valid certificates');

    const domainNameResource = await getDomainNameResource();
    console.log('Received domain name resource');

    const newTrustStoreVersion = await updateTruststore(truststoreBucketName, pemFilePath);
    console.log('Truststore updated');
    console.log('New truststore version: ', newTrustStoreVersion);

    await updateTruststoreVersion(domainNameResource, newTrustStoreVersion);
  } catch (err) {
    console.error(err);
    throw new Error('Error updating truststore');
  }

  console.log('Truststore update completed!');
}

/**
 * Get certificates from the s3 bucket with validation
 * @returns list of certificate info objects with validation data
 */
export async function getCertificatesWithValidation(): Promise<Array<CertificateInfo>> {
  const certificateInfos = new Array<CertificateInfo>();
  const listObjectsResponse = await s3client.send(new ListObjectsV2Command({ Bucket: bucketName }));
  console.log(listObjectsResponse);
  const objects = listObjectsResponse?.Contents ?? [];

  for (const object of objects) {
    try {
      const response = await s3client.send(new GetObjectCommand({ Bucket: bucketName, Key: object.Key ?? '' }));
      const certificate = await response.Body?.transformToString();
      if (certificate && object.Key) {
        const certInfo = await validateCertificate(certificate, object.Key);
        certificateInfos.push(certInfo);
      }
    } catch (err) {
      if (err instanceof NoSuchKey) {
        console.error(
          `Error from S3 while getting object "${object.Key}" from "${bucketName}". No such key exists.`,
        );
      } else if (err instanceof S3ServiceException) {
        console.error(
          `Error from S3 while getting object from ${bucketName}.  ${err.name}: ${err.message}`,
        );
      } else {
        throw err;
      }
    }
  };

  return certificateInfos;
}

/**
 * Get certificates from the s3 bucket
 * @param s3 S3 client
 * @param bucketName bucket name
 * @returns list of certificate objects
 */
export async function getCertificates(): Promise<Array<string>> {
  const certificates = new Array<string>();
  const listObjectsResponse = await s3client.send(new ListObjectsV2Command({ Bucket: bucketName }));
  console.log(listObjectsResponse);
  const objects = listObjectsResponse?.Contents ?? [];

  for (const object of objects) {
    try {
      const response = await s3client.send(new GetObjectCommand({ Bucket: bucketName, Key: object.Key ?? '' }));
      const certificate = await response.Body?.transformToString();
      if (certificate) {
        certificates.push(certificate);
      }
    } catch (err) {
      if (err instanceof NoSuchKey) {
        console.error(
          `Error from S3 while getting object "${object.Key}" from "${bucketName}". No such key exists.`,
        );
      } else if (err instanceof S3ServiceException) {
        console.error(
          `Error from S3 while getting object from ${bucketName}.  ${err.name}: ${err.message}`,
        );
      } else {
        throw err;
      }
    }
  };

  return certificates;
}

/**
 * Validate a certificate and extract expiration information
 * @param certificateContent PEM certificate content
 * @param key S3 object key for identification
 * @returns Certificate information with validation data
 */
export async function validateCertificate(certificateContent: string, key: string): Promise<CertificateInfo> {
  try {
    // Parse the certificate
    const cert = new crypto.X509Certificate(certificateContent);

    const now = new Date();
    const validFrom = new Date(cert.validFrom);
    const validTo = new Date(cert.validTo);

    const isValid = now >= validFrom && now <= validTo;
    const daysUntilExpiration = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      content: certificateContent,
      key,
      isValid,
      expirationDate: validTo,
      daysUntilExpiration,
      subject: cert.subject,
      issuer: cert.issuer,
    };
  } catch (err) {
    console.error(`Error validating certificate ${key}:`, err);
    // Return invalid certificate info if parsing fails
    return {
      content: certificateContent,
      key,
      isValid: false,
      expirationDate: new Date(0),
      daysUntilExpiration: -1,
      subject: 'Unknown',
      issuer: 'Unknown',
    };
  }
}

/**
 * Send certificate expiration metrics to CloudWatch
 * @param certificateInfos Array of certificate information
 */
export async function sendCertificateMetrics(certificateInfos: Array<CertificateInfo>): Promise<void> {
  try {
    const metricData = [];

    for (const cert of certificateInfos) {
      // Metric for days until expiration
      metricData.push({
        MetricName: 'CertificateDaysUntilExpiration',
        Dimensions: [
          {
            Name: 'CertificateKey',
            Value: cert.key,
          },
          {
            Name: 'Subject',
            Value: cert.subject.substring(0, 255), // CloudWatch dimension value limit
          },
        ],
        Value: cert.daysUntilExpiration,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
      });

      // Metric for certificate validity (1 = valid, 0 = invalid)
      metricData.push({
        MetricName: 'CertificateValidity',
        Dimensions: [
          {
            Name: 'CertificateKey',
            Value: cert.key,
          },
        ],
        Value: cert.isValid ? 1 : 0,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
      });
    }

    // Send metrics in batches (CloudWatch limit is 20 metrics per request)
    const batchSize = 20;
    for (let i = 0; i < metricData.length; i += batchSize) {
      const batch = metricData.slice(i, i + batchSize);
      await cloudwatch.send(new PutMetricDataCommand({
        Namespace: 'CertificateMonitoring',
        MetricData: batch,
      }));
    }

    console.log(`Sent ${metricData.length} certificate metrics to CloudWatch`);
  } catch (err) {
    console.error('Error sending certificate metrics to CloudWatch:', err);
    // Don't throw here to avoid breaking the main truststore update process
  }
}

/**
 * Build new truststore with the certificates and write it to a pem file
 * @param certificates list of certificates
 * @returns path of the pem file
 */
export async function buildNewTruststore(certificates: Array<string>): Promise<string> {
  try {
    if (certificates.length === 0) {
      throw new Error('No certificates provided');
    }

    const pemContent = certificates.join('\n');

    const pemFilePath = path.join('/tmp', 'truststore.pem');
    fs.writeFileSync(pemFilePath, pemContent);

    return pemFilePath;

  } catch (err) {
    console.error(err);
    throw new Error('Error building truststore');
  }
}

/**
 * Get current domain name
 * @param api gateway api
 * @param domainName domain name of the api
 * @returns current domain name
 */
export async function getDomainNameResource(): Promise<GetDomainNameCommandOutput> {
  try {
    const domainNameResource = await api.send(new GetDomainNameCommand({
      DomainName: domainName,
    }));
    return domainNameResource;
  } catch (err) {
    console.error(err);
    throw new Error('Error getting domain name resource');
  }
}

/**
 * Update truststore in the s3 bucket
 * @param truststore truststore bucket
 * @param bucketName bucket name
 * @param pemFilePath file path of the pem file
 * @returns version id of the new truststore
 */
export async function updateTruststore(trustStoreBucketName: string, pemFilePath: string): Promise<any> {
  const params = {
    Bucket: trustStoreBucketName,
    Key: 'truststore.pem',
    Body: fs.createReadStream(pemFilePath),
    ContentType: 'application/x-pem-file',
  };

  try {
    const result = await s3client.send(new PutObjectCommand(params));
    return result.VersionId;
  } catch (err) {
    console.error(err);
    throw new Error('Error updating truststore in S3');
  }

}

/**
 * Update truststore version in the api gateway (domain name)
 * @param api gateway api
 * @param domainName domain name of the api
 * @param truststoreUri truststore uri
 * @param newTruststoreVersion new truststore version
 */
export async function updateTruststoreVersion(domainNameResource: GetDomainNameCommandOutput, newTruststoreVersion: string): Promise<any> {
  const truststoreUri = domainNameResource.MutualTlsAuthentication?.TruststoreUri ?? '';
  const gatewayCertificateArn = domainNameResource.DomainNameConfigurations?.[0]?.CertificateArn ?? '';

  try {
    const update = await api.send(new UpdateDomainNameCommand({
      DomainName: domainName,
      DomainNameConfigurations: [
        {
          CertificateArn: gatewayCertificateArn,
        },
      ],
      MutualTlsAuthentication: {
        TruststoreUri: truststoreUri,
        TruststoreVersion: newTruststoreVersion,
      },
    }));

    return update;
  } catch (err) {
    console.error('Error updating truststore version: ', err);
    throw new Error('Error updating truststore version');
  }
}