import * as https from 'https';
import { DynamoDB } from 'aws-sdk';
import nodefetch from 'node-fetch';
import { initSecrets, PersonenSecrets } from './initSecrets';

let secrets: PersonenSecrets;
let init = initSecrets();

export async function handler (event: any):Promise<any> {

  if (!secrets) {
    secrets = await init;
  }

  const request = JSON.parse(event.body);
  const apiKey = event.requestContext.identity.apiKey;

  const idTable = new DynamoDB.DocumentClient();

  const validProfile = await validateFields(request.fields, apiKey, idTable);


  if (validProfile) {
    // Search...
    return callHaalCentraal(event.body, secrets);
  } else {
    return {
      statusCode: '403', //Forbidden
      body: 'Mismatch in application/profile',
      headers: { 'Content-Type': 'text/plain' },
    };
  }
};

export async function validateFields(receivedFields: [], applicationId: string, idTable: DynamoDB.DocumentClient) {
  const allowedFields = new Set(await getAllowedFields(applicationId, idTable));
  const check = receivedFields.every(receivedField => allowedFields.has(receivedField)); // Validate if every field in the received fields is part of the allowed fields in the profile.
  return check;
}

export async function getAllowedFields(apiKey: string, idTable: DynamoDB.DocumentClient) {
  const tableName = process.env.ID_TABLE_NAME!;

  const data = await idTable.get({
    TableName: tableName,
    Key: {
      id: apiKey,
    },
  }).promise();

  return data.Item?.fields.values; // Returns a list of all allowed fields
}

export async function callHaalCentraal(content: string, secret: any) {

  var rejectUnauthorized = true;
  if (process.env.DEV_MODE! == 'true') {
    rejectUnauthorized = false;
  }

  try {
    const agent = new https.Agent({
      key: secret.certKey,
      cert: secret.cert,
      ca: secret.certCa,
      rejectUnauthorized: rejectUnauthorized,
    });

    // Nodefetch used for agent integration (certs and rejectUnauthorized) instead of native fetch
    const resp = await nodefetch(
      secret.endpoint,
      {
        method: 'POST',
        body: content,
        headers: {
          'Content-type': 'application/json',
          'X-API-KEY': secret.brpApiKey,
        },
        agent: agent,
      },
    );

    const data = resp.json();

    return {
      statusCode: resp.status,
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    };
  }

}