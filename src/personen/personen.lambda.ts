import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { Subsegment } from 'aws-xray-sdk-core';
import { callHaalCentraal } from './callHaalCentraal';
import { initSecrets, PersonenSecrets } from './initSecrets';

let secrets: PersonenSecrets;
let init = initSecrets();
let tracer: Tracer | undefined;
const dynamodb = new DynamoDBClient();

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
  try {
    if (!secrets) {
      secrets = await init;
    }

    const request = JSON.parse(event.body);
    const apiKey = event.requestContext.identity.apiKey;

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
    if (segment && subsegment) {
      // Close subsegment (the AWS Lambda one is closed automatically)
      subsegment.close();
      // Set back the facade segment as active again
      tracer?.setSegment(segment);
    }
  }
}
/**
 * Validate if every field in the received fields is part of the allowed fields in the profile.
 * @param receivedFields Fields received from the original request
 * @param applicationId The application identification number (api key)
 * @returns Wether or not the given fields in the request are allowed by the specific application
 */
export async function validateFields(receivedFields: string[], applicationId: string) {
  const allowedFields = new Set(await getAllowedFields(applicationId));
  const check = receivedFields.every(receivedField => allowedFields.has(receivedField));
  return check;
}

/**
 * Returns the list of all allowed fields.
 * @param apiKey The api key part of the original request
 * @param idTable The table that contains the application ids and related fields
 * @returns List of all allowed fields
 */
export async function getAllowedFields(apiKey: string) {
  const tableName = process.env.ID_TABLE_NAME!;

  const data = await dynamodb.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      id: { S: apiKey },
    },
  }));

  return data.Item?.fields.SS;
}
