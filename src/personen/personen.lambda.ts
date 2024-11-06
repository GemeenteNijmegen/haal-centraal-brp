import * as https from 'https';
import { DynamoDB } from 'aws-sdk';
import nodefetch from 'node-fetch';
import { initSecrets, PersonenSecrets } from './initSecrets';

export async function handler (event: any, _context: any):Promise<any> {
  const request = JSON.parse(event.body);
  const apiKey = event.requestContext.identity.apiKey;

  const idTable = new DynamoDB.DocumentClient();

  const validProfile = await validateFields(request.fields, apiKey, idTable);

  const secrets = await initSecrets();

  if (validProfile) {
    // Search...
    return callHaalCentraal(event.body, await getSecrets(secrets));
  } else {
    return {
      statusCode: '403', //Forbidden
      body: 'Mismatch in application/profile',
      headers: { 'Content-Type': 'text/plain' },
    };
  }
};

export async function getSecrets(secrets: PersonenSecrets) {
  return {
    certKey: secrets.certKey,
    cert: secrets.cert,
    certCa: secrets.certCa,
    endpoint: secrets.endpoint,
    brpApiKey: secrets.brpApiKey,
  };
}

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

export async function callHaalCentraal(content: string, secrets: any) {

  var rejectUnauthorized = true;
  if (process.env.DEV_MODE! == 'true') {
    rejectUnauthorized = false;
  }

  try {
    const agent = new https.Agent({
      key: secrets.certKey,
      cert: secrets.cert,
      ca: secrets.certCa,
      rejectUnauthorized: rejectUnauthorized,
    });

    const resp = await nodefetch(
      secrets.endpoint,
      {
        method: 'POST',
        body: content,
        headers: {
          'Content-type': 'application/json',
          'X-API-KEY': secrets.brpApiKey,
        },
        agent: agent,
      },
    );

    const data = await resp.json();

    return {
      statusCode: await resp.status,
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