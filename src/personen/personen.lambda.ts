import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { callHaalCentraal } from './callHaalCentraal';
import { initSecrets, PersonenSecrets } from './initSecrets';

let secrets: PersonenSecrets;
let init = initSecrets();
const dynamodb = new DynamoDBClient();


export async function handler(event: any): Promise<any> {

  if (!secrets) {
    secrets = await init;
  }

  const request = JSON.parse(event.body);
  const apiKey = event.requestContext.identity.apiKey;


  const validProfile = await validateFields(request.fields, apiKey);


  if (validProfile) {
    // Search...
    return callHaalCentraal(event.body, secrets); // in aparte file zetten
  } else {
    return {
      statusCode: '403', //Forbidden
      body: 'Mismatch in application/profile',
      headers: { 'Content-Type': 'text/plain' },
    };
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