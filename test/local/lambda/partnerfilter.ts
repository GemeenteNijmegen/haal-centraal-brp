import { withApiKeyIdentity } from './withApiKeyIdentity';
import { handler as partnerFilterHandler } from '../../../src/personen/partner-filter/partner-filter.lambda';
import { localConfig } from '../cdk/localConfig';

export const handler = withApiKeyIdentity(partnerFilterHandler, localConfig.applications.map(application => ({
  id: application.id,
  value: application.apiKey,
})));
