import * as https from 'https';
import { AWS } from '@gemeentenijmegen/utils';
import { DynamoDB } from 'aws-sdk';
import nodefetch from 'node-fetch';

export async function handler (event: any, _context: any):Promise<any> {
  const request = JSON.parse(event.body);
  const apiKey = event.requestContext.identity.apiKey;

  const idTable = new DynamoDB.DocumentClient();

  const validProfile = validateFields(request.fields, apiKey, idTable);

  const certKey = await AWS.getSecret(process.env.CERTIFICATE_KEY!);
  const cert = await AWS.getSecret(process.env.CERTIFICATE!);
  const certCa = await AWS.getSecret(process.env.CERTIFICATE_CA!);
  const endpoint = await AWS.getParameter(process.env.LAYER7_ENDPOINT!);
  const brpApiKey = await AWS.getSecret(process.env.BRP_API_KEY_ARN!);

  if (await validProfile) {
    // Search...
    return zoek(request, certKey, cert, certCa, endpoint, brpApiKey);
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

export async function callHaalCentraal(content: string, certKey: string, cert: string, certCa: string, endpoint: string, brpApiKey: string) {

  const agent = new https.Agent({
    key: certKey,
    cert: cert,
    ca: certCa,
    rejectUnauthorized: false, // TODO should be true, but this raises a 'Self-signed certificate in certificate' chain error
  });

  const resp = await nodefetch(
    endpoint,
    {
      method: 'POST',
      body: content,
      headers: {
        'Content-type': 'application/json',
        'X-API-KEY': brpApiKey,
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

}

export async function zoek(request: any, certKey: string, cert: string, certCa: string, endpoint: string, brpApiKey: string) {

  const content = {
    ...(request.type && { type: request.type }),
    ...(request.fields && { fields: request.fields }),
    ...(request.gemeenteVanInschrijving && { gemeenteVanInschrijving: request.gemeenteVanInschrijving }),
    ...(request.inclusiefOverledenPersonen && { inclusiefOverledenPersonen: request.inclusiefOverledenPersonen }),

    ...(request.burgerservicenummer && { burgerservicenummer: request.burgerservicenummer }),

    ...(request.huisletter && { huisletter: request.huisletter }),
    ...(request.huisnummer && { huisnummer: request.huisnummer }),
    ...(request.huisnummertoevoeging && { huisnummertoevoeging: request.huisnummertoevoeging }),
    ...(request.postcode && { postcode: request.postcode }),
    ...(request.straat && { straat: request.straat }),

    ...(request.geboortedatum && { geboortedatum: request.geboortedatum }),
    ...(request.geslacht && { geslacht: request.geslacht }),
    ...(request.geslachtsnaam && { geslachtsnaam: request.geslachtsnaam }),
    ...(request.voorvoegsel && { voorvoegsel: request.voorvoegsel }),
    ...(request.voornamen && { voornamen: request.voornamen }),

    ...(request.nummeraanduidingIdentificatie && { nummeraanduidingIdentificatie: request.voornummeraanduidingIdentificatienamen }),
    ...(request.adresseerbaarObjectIdentificatie && { adresseerbaarObjectIdentificatie: request.adresseerbaarObjectIdentificatie }),
  };

  return callHaalCentraal(JSON.stringify(content), certKey, cert, certCa, endpoint, brpApiKey );

}