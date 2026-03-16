import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Bsn } from '@gemeentenijmegen/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { Subsegment } from 'aws-xray-sdk-core';
import { callHaalCentraal } from '../callHaalCentraal';
import { initSecrets, PersonenSecrets } from '../initSecrets';
import { getApplicationProfile, validateFields } from '../validateFields';
import { createErrorResponse } from './errors/error-response';
import { EndpointNotFoundError, HaalCentraalError, InvalidApplicationProfileError, InvalidBsnError, InvalidResourcePathError, MissingBsnError, NoPersonDataError } from './errors/subset-errors';
import { SubsetHandlerFactory } from './handlers/subset-handler-factory';

let secrets: PersonenSecrets;
let init = initSecrets();
let tracer: Tracer | undefined;

const logger = new Logger({ serviceName: 'HaalCentraal' });

if (process.env.TRACING_ENABLED) {
  tracer = new Tracer({ serviceName: 'haalcentraal-personen-subset', captureHTTPsRequests: true });
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const segment = tracer?.getSegment(); // This is the facade segment (the one that is created by AWS Lambda)
  let subsegment: Subsegment | undefined;
  if (tracer && segment) {
    // Create subsegment for the function & set it as active
    subsegment = segment.addNewSubsegment(`## ${process.env._HANDLER}`);
    tracer.setSegment(subsegment);
  }
  tracer?.annotateColdStart();
  tracer?.addServiceNameAnnotation();

  // Add the API key as an annotation
  const apiKeyId: string = event.requestContext.identity.apiKeyId ?? 'unknown apiKeyId';
  tracer?.putAnnotation('API Key ID', apiKeyId);
  let profileName:string = '';

  try {
    if (!secrets) {
      secrets = await init;
    }

    // Get requesting application to log and validate
    const apiKey: string = event.requestContext.identity.apiKey ?? 'unknown apiKey';
    const profile = await getApplicationProfile(apiKey);
    profileName = getProfileName(profile);


    const bsn = getBSNFromHeader(event);

    const endpoint = getEndpointFromPath(event);
    const subsetHandler = SubsetHandlerFactory.getHandler(endpoint);

    const fields = subsetHandler.getFields();


    // Requestin application access to fields?
    const validProfile = validateFields(fields, profile.fields);
    if (!validProfile) {
      throw new InvalidApplicationProfileError(fields);
    }

    const { persoon, result } = await getPersonHaalCentraal(fields, bsn);
    const responseBody = subsetHandler.processResponse(persoon);

    return {
      statusCode: result.statusCode,
      body: JSON.stringify(responseBody),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error) {
    return createErrorResponse(error, logger, profileName);
  } finally {
    if (tracer && segment && subsegment) {
      // Close subsegment (the AWS Lambda one is closed automatically)
      subsegment.close();
      // Set back the facade segment as active again
      tracer?.setSegment(segment);
    }
  }
}

function getProfileName( profile: { fields: string[]; name: string }) {
  const profileName = profile.name ?? 'unknown profile name';
  logger.info('Request info', {
    application: profile.name,
    type: 'subset',
  });
  tracer?.putAnnotation('Profile Name', profileName);
  return profileName;
}

async function getPersonHaalCentraal(fields: string[], bsn: string) {
  const body = requestJsonBody(fields, [bsn]);
  const result = await callHaalCentraal(body, secrets);

  // Check eerst of de status code in de 200 range zit
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new HaalCentraalError(result.statusCode, result.body);
  }
  // Als parsen niet lukt dan wordt een algemene 500 gegooid
  const data = JSON.parse(result.body);
  if (!data?.personen?.[0] || !data?.personen?.[0].burgerservicenummer) {
    throw new NoPersonDataError();
  }
  const persoon = data.personen[0];
  return { persoon, result };
}

function requestJsonBody(fields: string[], bsn: string[]): string {
  const body = {
    type: 'RaadpleegMetBurgerservicenummer',
    fields: fields,
    burgerservicenummer: bsn,
  };
  return JSON.stringify(body);
}

// Assumes the lambda receives an event.resource with a path containing at least three parts url/[part1]/[part2]/[part3]
function getEndpointFromPath(event: APIGatewayProxyEvent): string {
  if (!event.resource) {
    throw new EndpointNotFoundError('no endpoint found');
  }
  const parts = event.resource.split('/').filter(part => part.length > 0);

  if (parts.length < 3 || !parts[2]) {
    throw new InvalidResourcePathError(event.resource);
  }

  return parts[2];
}

function getBSNFromHeader(event: APIGatewayProxyEvent): string {
  const bsn = event.headers['x-bsn']?.trim();
  if (!bsn) {
    throw new MissingBsnError();
  }
  try {
    new Bsn(bsn);
  } catch {
    throw new InvalidBsnError();
  }
  return bsn;
}