import * as fs from 'fs';
import * as path from 'path';
import { ApiGatewayV2, S3 } from 'aws-sdk';

const api = new ApiGatewayV2();
const s3 = new S3();
const bucketName = process.env.CERT_BUCKET_NAME ?? '';
const domainName = process.env.CUSTOM_DOMAIN_NAME ?? '';

export async function handler(event: any): Promise<any> {
  console.log('Updating truststore...');
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const certificates = await getCertificates();
    console.log('Received certificates');

    const pemFilePath = await buildNewTruststore(certificates);
    console.log('New truststore build');

    const currentDomainName = await getCurrentDomainName();
    console.log('Received current domain name');

    const newTrustStoreVersion = await updateTruststore(pemFilePath);
    console.log('Truststore updated');
    console.log('New truststore version: ', newTrustStoreVersion);

    await updateTruststoreVersion(currentDomainName.MutualTlsAuthentication?.TruststoreUri ?? '', newTrustStoreVersion);
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
  const objects = (await s3.listObjectsV2({ Bucket: bucketName }).promise()).Contents ?? [];

  objects.forEach(async object => {
    if (object.Key) {
      certificates.push((await s3.getObject({ Bucket: bucketName, Key: object.Key }).promise()).Body?.toString() ?? '');
    }
  });

  return certificates;
}

/**
 * Build new truststore with the certificates and write it to a pem file
 * @param certificates list of certificates
 * @returns path of the pem file
 */
export async function buildNewTruststore(certificates: Array<string>): Promise<string> {
  try {
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
export async function getCurrentDomainName(): Promise<ApiGatewayV2.GetDomainNameResponse> {
  try {
    const currentDomainName = await api.getDomainName({
      DomainName: domainName,
    }).promise();
    return currentDomainName;
  } catch (err) {
    console.error(err);
    throw new Error('Error getting domain name');
  }
}

/**
 * Update truststore in the s3 bucket
 * @param truststore truststore bucket
 * @param bucketName bucket name
 * @param pemFilePath file path of the pem file
 * @returns version id of the new truststore
 */
export async function updateTruststore(pemFilePath: string): Promise<any> {
  const params = {
    Bucket: bucketName,
    Key: 'truststore.pem',
    Body: fs.createReadStream(pemFilePath),
    ContentType: 'application/x-pem-file',
  };

  try {
    return (await s3.putObject(params).promise()).VersionId;
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
export async function updateTruststoreVersion(truststoreUri: ApiGatewayV2.UriWithLengthBetween1And2048, newTruststoreVersion: string): Promise<any> {
  api.updateDomainName({
    DomainName: domainName,
    MutualTlsAuthentication: {
      TruststoreUri: truststoreUri,
      TruststoreVersion: newTruststoreVersion,
    },
  }, (err, data) => {
    if (err) {
      console.error(err);
      throw new Error('Error updating truststore version');
    } else {
      console.log(data);
    }
  });
}