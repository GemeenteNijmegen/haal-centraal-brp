import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { callHaalCentraal } from '../callHaalCentraal';
import { initSecrets, PersonenSecrets } from '../initSecrets';
import { validateFields } from '../validateFields';

let secrets: PersonenSecrets;
let init = initSecrets();
let tracer: Tracer | undefined;

if (process.env.TRACING_ENABLED) {
  tracer = new Tracer({ serviceName: 'haalcentraal-personen-subset', captureHTTPsRequests: true });
}

export async function handler(event: any): Promise<any> {
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
  const apiKeyId = event.requestContext.identity.apiKeyId;
  tracer?.putAnnotation('API Key ID', apiKeyId);

  try {
    if (!secrets) {
      secrets = await init;
    }

    const fields = [
      'kinderen',
      'leeftijd',
      'partners',
    ];

    const apiKey = event.requestContext.identity.apiKey;
    const validProfile = await validateFields(fields, apiKey);

    if (validProfile) {
      // Search...
      const bsn = event.pathParameters.bsn;
      const body = await jsonBody(fields, [bsn]);
      const result = await callHaalCentraal(body, secrets);

      const data = JSON.parse(result.body);
      const persoon = data.personen[0];
      let hasKinderen = false;
      let hasPartners = false;

      if (persoon.kinderen && persoon.kinderen.length > 0) {
        hasKinderen = true;
      }

      if (persoon.partners && persoon.partners.length > 0) {
        hasPartners = true;
      };

      const responseBody = {
        leeftijd: persoon.leeftijd,
        kinderen: hasKinderen,
        partners: hasPartners,
      };

      return {
        statusCode: result.statusCode,
        body: JSON.stringify(responseBody),
        headers: { 'Content-Type': 'application/json' },
      };

    } else {
      return {
        statusCode: '403', //Forbidden
        body: 'Mismatch in application/profile',
        headers: { 'Content-Type': 'text/plain' },
      };
    }
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    };
  } finally {
    if (tracer && segment && subsegment) {
      // Close subsegment (the AWS Lambda one is closed automatically)
      subsegment.close();
      // Set back the facade segment as active again
      tracer?.setSegment(segment);
    }
  }
}

async function jsonBody(fields: string[], bsn: string[]): Promise<string> {
  const body = {
    type: 'RaadpleegMetBurgerservicenummer',
    fields: fields,
    burgerservicenummer: bsn,
  };
  return JSON.stringify(body);
}
