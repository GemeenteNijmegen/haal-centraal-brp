import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { Subsegment } from 'aws-xray-sdk-core';
import { callHaalCentraal } from '../callHaalCentraal';
import { PersonenSecrets, initSecrets } from '../initSecrets';
import { createErrorResponse } from '../subset/errors/error-response';
import {
  HaalCentraalError,
  InvalidApplicationProfileError,
  NoPersonDataError,
} from '../subset/errors/subset-errors';
import { getApplicationProfile, validateFields } from '../validateFields';

/**
 * Temporary endpoint, which will be removed once https://github.com/open-formulieren/open-forms/issues/5856 has been implemented and tested
 * If a personen call to this endpoint contains a partners request field, it should add partners.ontbindingHuwelijkPartnerschap to the requested field
 * Once the result returns it should check if the returned partners (always max one) contains a ontbindingHuewelijkPartnerschap object.
 * If it does contain ontbindingHuwelijkPartnerschap, it should remove the partner from the result which is returned.
 * Important is that this is the only change for now and the solution is temporary.
 * Hence it is implemented on a different endpoint, the applications themselves can choose to use the temporary endpoint or not.
 *
 * Due to the temporary nature, I reused the errors from subset.
 */

const ONTBINDING_FIELD = 'partners.ontbindingHuwelijkPartnerschap';

let secrets: PersonenSecrets;
let init = initSecrets();
let tracer: Tracer | undefined;

const logger = new Logger({ serviceName: 'HaalCentraal' });

if (process.env.TRACING_ENABLED) {
  tracer = new Tracer({
    serviceName: 'haalcentraal-personen-partner-filter',
    captureHTTPsRequests: true,
  });
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const segment = tracer?.getSegment();
  let subsegment: Subsegment | undefined;
  if (tracer && segment) {
    subsegment = segment.addNewSubsegment(`## ${process.env._HANDLER}`);
    tracer.setSegment(subsegment);
  }
  tracer?.annotateColdStart();
  tracer?.addServiceNameAnnotation();

  const apiKeyId: string = event.requestContext.identity.apiKeyId ?? 'unknown apiKeyId';
  tracer?.putAnnotation('API Key ID', apiKeyId);
  let profileName: string = '';

  try {
    if (!secrets) {
      secrets = await init;
    }

    const request = JSON.parse(event.body ?? '{}');
    const apiKey: string =
      event.requestContext.identity.apiKey ?? 'unknown apiKey';

    const profile = await getApplicationProfile(apiKey);
    profileName = getProfileName(profile);

    const originalFields: string[] = request.fields ?? [];

    const validProfile = validateFields(originalFields, profile.fields);
    if (!validProfile) {
      throw new InvalidApplicationProfileError(originalFields);
    }

    const hasPartnerFields = originalFields.some(
      (f) => f === 'partners' || f.startsWith('partners.'),
    );
    // Voeg extra ontbinding request field toe na validatie
    const fieldsForRequest = hasPartnerFields
      ? addOntbindingField(originalFields)
      : originalFields;

    const body = JSON.stringify({ ...request, fields: fieldsForRequest });
    const result = await callHaalCentraal(body, secrets);

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new HaalCentraalError(result.statusCode, result.body);
    }

    const data = JSON.parse(result.body);
    if (!data?.personen?.[0]) {
      throw new NoPersonDataError();
    }

    // Filter alleen als de aanroep om partnerdata vraagt
    const filteredData = hasPartnerFields
      ? filterDissolvedPartners(data)
      : data;

    return {
      statusCode: result.statusCode,
      body: JSON.stringify(filteredData),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error) {
    return createErrorResponse(error, logger, profileName);
  } finally {
    if (tracer && segment && subsegment) {
      subsegment.close();
      tracer?.setSegment(segment);
    }
  }
}

function getProfileName(profile: { fields: string[]; name: string }): string {
  const profileName = profile.name ?? 'unknown profile name';
  logger.info('Request info', {
    application: profile.name,
    type: 'partner-filter',
  });
  tracer?.putAnnotation('Profile Name', profileName);
  return profileName;
}

/**
 * Adds ontbindingHuwelijkPartnerschap to the fields if not already present.
 */
export function addOntbindingField(fields: string[]): string[] {
  if (fields.includes(ONTBINDING_FIELD)) {
    return fields;
  }
  return [...fields, ONTBINDING_FIELD];
}

/**
 * Removes partners that have ontbindingHuwelijkPartnerschap set,
 * as those are dissolved marriages or partnerships.
 */
export function filterDissolvedPartners(data: any): any {
  const personen = data.personen?.map((persoon: any) => {
    if (!Array.isArray(persoon.partners)) {
      return persoon;
    }
    return {
      ...persoon,
      partners: persoon.partners.filter(
        (partner: any) => !partner.ontbindingHuwelijkPartnerschap,
      ),
    };
  });

  return { ...data, personen };
}
