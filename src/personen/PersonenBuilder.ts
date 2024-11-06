import { AWS } from '@gemeentenijmegen/utils';

export class PersonenBuilder {
  static async initSecrets(arns: string[]) {
    const secrets = arns.map(arn => AWS.getSecret(arn));
    return Promise.all(secrets);
  }
}