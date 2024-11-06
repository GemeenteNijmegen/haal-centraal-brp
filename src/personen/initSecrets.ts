import { AWS } from '@gemeentenijmegen/utils';

export interface PersonenSecrets {
  certKey: string;
  cert: string;
  certCa: string;
  endpoint: string;
  brpApiKey: string;
}

export async function initSecrets(): Promise<PersonenSecrets> {
  const [certKey, cert, certCa, endpoint, brpApiKey] = await Promise.all([
    AWS.getSecret(process.env.CERTIFICATE_KEY!),
    AWS.getSecret(process.env.CERTIFICATE!),
    AWS.getSecret(process.env.CERTIFICATE_CA!),
    AWS.getSecret(process.env.LAYER7_ENDPOINT!),
    AWS.getSecret(process.env.BRP_API_KEY_ARN!),
  ]);

  const secrets: PersonenSecrets = {
    certKey: certKey,
    cert: cert,
    certCa: certCa,
    endpoint: endpoint,
    brpApiKey: brpApiKey,

  };

  return secrets;
}