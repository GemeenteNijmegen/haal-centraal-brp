import { withApiKeyIdentity } from './withApiKeyIdentity';
import { handler as personenHandler } from '../../../src/personen/personen.lambda';
import { localConfig } from '../cdk/localConfig';

export const handler = withApiKeyIdentity(personenHandler, localConfig.applications.map(application => ({
  id: application.id,
  value: application.apiKey,
})));
