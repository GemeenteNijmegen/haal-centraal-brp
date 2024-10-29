import * as https from 'https';
import { Bsn, AWS } from '@gemeentenijmegen/utils';
import { DynamoDB } from 'aws-sdk';
import nodefetch from 'node-fetch';

export async function handler (event: any, _context: any, callback: any):Promise<any> {
  const request = JSON.parse(event.body);
  const apiKey = event.requestContext.identity.apiKey;

  const idTable = new DynamoDB.DocumentClient();

  const validProfile = validateFields(request.fields, apiKey, idTable);

  if (await validProfile) {
    // switch ( request.type ) {
    //   case 'ZoekMetGeslachtsnaamEnGeboortedatum':
    //     await zoekMetGeslachtsnaamEnGeboortedatum(request);
    //     break;
    //   case 'ZoekMetNaamEnGemeenteVanInschrijving':
    //     await zoekMetNaamEnGemeenteVanInschrijving(request);
    //     break;
    //   case 'RaadpleegMetBurgerservicenummer':
    //     return raadpleegMetBurgerservicenummer(request);
    //   case 'ZoekMetPostcodeEnHuisnummer':
    //     await zoekMetPostcodeEnHuisnummer(request);
    //     break;
    //   case 'ZoekMetStraatHuisnummerEnGemeenteVanInschrijving':
    //     await zoekMetStraatHuisnummerEnGemeenteVanInschrijving(request);
    //     break;
    //   case 'ZoekMetNummeraanduidingIdentificatie':
    //     await zoekMetNummeraanduidingIdentificatie(request);
    //     break;
    //   case 'ZoekMetAdresseerbaarObjectIdentificatie':
    //     await zoekMetAdresseerbaarObjectIdentificatie(request);
    //     break;
    //   default:
    //     console.log('Unknown Request Type');
    //     return {
    //       statusCode: '400', //Bad request
    //       body: 'Unknown request type',
    //       headers: { 'Content-Type': 'text/plain' },
    //     };
    // }
    await zoek(request);
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

export async function callHaalCentraal(content: string) {

  const certKey = await AWS.getSecret(process.env.CERTIFICATE_KEY!);
  const cert = await AWS.getSecret(process.env.CERTIFICATE!);
  const certCa = await AWS.getSecret(process.env.CERTIFICATE_CA!);

  const agent = new https.Agent({
    key: certKey,
    cert: cert,
    ca: certCa,
    rejectUnauthorized: false, // TODO should be true, but this raises a 'Self-signed certificate in certificate' chain error
  });

  const endpoint = process.env.LAYER7_ENDPOINT!;
  const brpApiKey = await AWS.getSecret(process.env.BRP_API_KEY_ARN!);

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
  console.log(data);
  console.log(await resp.status);

  return {
    statusCode: await resp.status,
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  };

}

export async function zoek(request: any) {

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

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetGeslachtsnaamEnGeboortedatum(request: any) {

  const content = {
    type: 'ZoekMetGeslachtsnaamEnGeboortedatum',
    fields: request.fields,
    inclusiefOverledenPersonen: true,
    geboortedatum: request.geboortedatum,
    geslachtsnaam: request.geslachtsnaam,
    geslacht: request.geslacht,
    voorvoegsel: request.voorvoegsel,
    voornamen: request.voornamen,
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetNaamEnGemeenteVanInschrijving(request: any) {

  const content = {
    type: 'ZoekMetNaamEnGemeenteVanInschrijving',
    ...(request.fields && { fields: request.fields }),
    ...(request.gemeenteVanInschrijving && { gemeenteVanInschrijving: request.gemeenteVanInschrijving }),
    ...(request.inclusiefOverledenPersonen && { inclusiefOverledenPersonen: request.inclusiefOverledenPersonen }),
    ...(request.geslacht && { geslacht: request.geslacht }),
    ...(request.geslachtsnaam && { geslachtsnaam: request.geslachtsnaam }),
    ...(request.voorvoegsel && { voorvoegsel: request.voorvoegsel }),
    ...(request.voornamen && { voornamen: request.voornamen }),
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function raadpleegMetBurgerservicenummer(request: any) {

  const bsnList: string[] = [];

  request.burgerservicenummer.forEach((bsn: string) => {
    const aBsn = new Bsn(bsn);
    bsnList.push(aBsn.bsn);
  });

  const content = {
    type: request.type,
    fields: request.fields,
    burgerservicenummer: bsnList,
  };

  return callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetPostcodeEnHuisnummer(request: any) {

  const content = {
    type: 'ZoekMetPostcodeEnHuisnummer',
    fields: request.fields,
    inclusiefOverledenPersonen: true,
    huisletter: request.huisletter,
    huisnummer: request.huisnummer,
    huisnummertoevoeging: request.huisnummertoevoeging,
    postcode: request.postcode,
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetStraatHuisnummerEnGemeenteVanInschrijving(request: any) {

  const content = {
    type: 'ZoekMetStraatHuisnummerEnGemeenteVanInschrijving',
    fields: request.fields,
    inclusiefOverledenPersonen: true,
    huisletter: request.huisletter,
    huisnummer: request.huisnummer,
    huisnummertoevoeging: request.huisnummertoevoeging,
    straat: request.straat,
  };

  await callHaalCentraal(JSON.stringify(content) );


}

export async function zoekMetNummeraanduidingIdentificatie(request: any) {

  const content = {
    type: 'ZoekMetNummeraanduidingIdentificatie',
    fields: request.fields,
    inclusiefOverledenPersonen: true,
    nummeraanduidingIdentificatie: request.nummeraanduidingIdentificatie,
  };

  await callHaalCentraal(JSON.stringify(content) );


}

export async function zoekMetAdresseerbaarObjectIdentificatie(request: any) {

  const content = {
    type: 'ZoekMetAdresseerbaarObjectIdentificatie',
    fields: request.fields,
    inclusiefOverledenPersonen: true,
    adresseerbaarObjectIdentificatie: request.adresseerbaarObjectIdentificatie,
  };

  await callHaalCentraal(JSON.stringify(content) );

}