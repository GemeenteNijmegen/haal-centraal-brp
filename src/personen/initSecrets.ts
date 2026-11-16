import { AWS, environmentVariables } from '@gemeentenijmegen/utils';

export interface PersonenSecrets {
  certKey: string;
  cert: string;
  certCa: string;
  endpoint: string;
  brpApiKey: string;
  bsnHashSalt: string;
}

export async function initSecrets(): Promise<PersonenSecrets> {
  const envKeys = [
    'CERTIFICATE_KEY',
    'CERTIFICATE',
    'CERTIFICATE_CA',
    'LAYER7_ENDPOINT',
    'BRP_API_KEY_ARN',
    'BSN_HASH_SALT_ARN',
  ];
  const env = environmentVariables(envKeys);

  const [certKey, cert, certCa, endpoint, brpApiKey, bsnHashSalt] = await Promise.all([
    AWS.getSecret(env.CERTIFICATE_KEY),
    AWS.getSecret(env.CERTIFICATE),
    AWS.getSecret(env.CERTIFICATE_CA),
    AWS.getParameter(env.LAYER7_ENDPOINT),
    AWS.getSecret(env.BRP_API_KEY_ARN),
    AWS.getSecret(env.BSN_HASH_SALT_ARN),
  ]);

  const secrets: PersonenSecrets = {
    certKey: certKey,
    cert: cert,
    certCa: certCa,
    endpoint: endpoint,
    brpApiKey: brpApiKey,
    bsnHashSalt: bsnHashSalt,

  };

  return secrets;
}