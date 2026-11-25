import { withApiKeyIdentity } from './withApiKeyIdentity';
import { handler as subsetHandler } from '../../../src/personen/subset/subset.lambda';
import { localConfig } from '../cdk/localConfig';

export const handler = withApiKeyIdentity(subsetHandler, localConfig.applications.map(application => ({
  id: application.id,
  value: application.apiKey,
})));
