import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { callHaalCentraal } from './callHaalCentraal';
import { initSecrets, PersonenSecrets } from './initSecrets';
import { validateFields } from './validateFields';

let secrets: PersonenSecrets;
let init = initSecrets();
let tracer: Tracer | undefined;

const logger = new Logger({ serviceName: 'HaalCentraal' });

if (process.env.TRACING_ENABLED) {
  tracer = new Tracer({ serviceName: 'haalcentraal-personen', captureHTTPsRequests: true });
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

    const request = JSON.parse(event.body);
    const apiKey = event.requestContext.identity.apiKey;

    logger.info('Request info', {
      application: apiKeyId,
      type: request.type,
    })

    const validProfile = await validateFields(request.fields, apiKey);

    if (validProfile) {
      // Search...
      return await callHaalCentraal(event.body, secrets); // in aparte file zetten
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
