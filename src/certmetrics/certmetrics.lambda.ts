import * as crypto from 'crypto';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

const s3client = new S3Client({ region: 'eu-central-1' });
const cloudwatch = new CloudWatchClient({ region: 'eu-central-1' });
const bucketName = process.env.CERT_BUCKET_NAME ?? '';

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
  console.log('Running certificate metrics and validation...');
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const certificateInfos = await getCertificatesWithValidation();
    console.log('Received and validated certificates');

    // Send certificate expiration metrics to CloudWatch
    await sendCertificateMetrics(certificateInfos);
    console.log('Certificate metrics sent to CloudWatch');

    // Log warnings for expired or soon-to-expire certificates
    certificateInfos.forEach(cert => {
      if (!cert.isValid) {
        console.warn(`Certificate ${cert.key} is expired or invalid. Subject: ${cert.subject}, Expiration: ${cert.expirationDate}`);
      } else if (cert.daysUntilExpiration <= 30) {
        console.warn(`Certificate ${cert.key} expires in ${cert.daysUntilExpiration} days. Subject: ${cert.subject}, Expiration: ${cert.expirationDate}`);
      }
    });

    console.log('Certificate metrics and validation completed successfully');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Certificate metrics processed successfully',
        certificatesProcessed: certificateInfos.length,
        validCertificates: certificateInfos.filter(cert => cert.isValid).length,
        expiredCertificates: certificateInfos.filter(cert => !cert.isValid).length,
      }),
    };
  } catch (err) {
    console.error('Error processing certificate metrics:', err);
    throw new Error('Error processing certificate metrics');
  }
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
    // Don't throw to avoid breaking the main process
  }
}