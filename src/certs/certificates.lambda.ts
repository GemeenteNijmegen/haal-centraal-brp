import * as fs from 'fs';
import * as path from 'path';
import { ApiGatewayV2Client, GetDomainNameCommand, GetDomainNameCommandOutput, UpdateDomainNameCommand } from '@aws-sdk/client-apigatewayv2';
import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

const api = new ApiGatewayV2Client({ region: 'eu-central-1' });
const s3client = new S3Client({ region: 'eu-central-1' });
const bucketName = process.env.CERT_BUCKET_NAME ?? '';
const truststoreBucketName = process.env.TRUSTSTORE_BUCKET_NAME ?? '';
const domainName = process.env.CUSTOM_DOMAIN_NAME ?? '';

export async function handler(event: any): Promise<any> {
  console.log('Updating truststore...');
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const certificates = await getCertificates();
    console.log('Received certificates');

    const pemFilePath = await buildNewTruststore(certificates);
    console.log('New truststore build');

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