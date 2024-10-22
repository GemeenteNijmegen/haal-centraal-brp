import * as https from 'https';
import { Bsn, AWS } from '@gemeentenijmegen/utils';
//import { DynamoDB } from 'aws-sdk';
import axios from 'axios';

export async function handler (event: any, _context: any):Promise<any> {
  // console.log(event);
  const request = JSON.parse(event.body);
  const apiKey = JSON.parse(event.requestContext.identity.apiKey);

  //const idTable = new DynamoDB.DocumentClient();

  // console.log('parse: ');
  // console.log(request);

  // console.log('read: ');
  // console.log(request.type);

  const validProfile = validateFields(request.fields, apiKey);

  if (await validProfile) {
    switch ( request.type ) {
      case 'ZoekMetGeslachtsnaamEnGeboortedatum':
        await zoekMetGeslachtsnaamEnGeboortedatum(request);
        break;
      case 'ZoekMetNaamEnGemeenteVanInschrijving':
        await zoekMetNaamEnGemeenteVanInschrijving(request);
        break;
      case 'RaadpleegMetBurgerservicenummer':
        return raadpleegMetBurgerservicenummer(request);
      case 'ZoekMetPostcodeEnHuisnummer':
        await zoekMetPostcodeEnHuisnummer(request);
        break;
      case 'ZoekMetStraatHuisnummerEnGemeenteVanInschrijving':
        await zoekMetStraatHuisnummerEnGemeenteVanInschrijving(request);
        break;
      case 'ZoekMetNummeraanduidingIdentificatie':
        await zoekMetNummeraanduidingIdentificatie(request);
        break;
      case 'ZoekMetAdresseerbaarObjectIdentificatie':
        await zoekMetAdresseerbaarObjectIdentificatie(request);
        break;
      default:
        console.log('Unknown Request Type');
        return {
          statusCode: '400', //Bad request
          body: 'Unknown request type',
          headers: { 'Content-Type': 'text/plain' },
        };
    }
  } else {
    return {
      statusCode: '403', //Forbidden
      body: 'Mismatch in application/profile',
      headers: { 'Content-Type': 'text/plain' },
    };
  }
};

export async function validateFields(receivedFields: [], applicationId: string) {
  const allowedFields = new Set(await getAllowedFields(applicationId));
  const check = receivedFields.every(receivedField => allowedFields.has(receivedField)); // Validate if every field in the received fields is part of the allowed fields in the profile.
  return check;
}

export async function getAllowedFields(apiKey: string) {
  //const tableName = process.env.ID_TABLE_NAME;

  // const data = await idTable.get({
  //   TableName: tableName + '',
  //   Key: {
  //     id: apiKey,
  //   },
  //   ProjectionExpression: 'fields',
  // }).promise();

  return ['aNummer', 'adressering', 'burgerservicenummer']; // Returns a list of all allowed fields
}

export async function callHaalCentraal(content: string) {

  const caKey = await AWS.getSecret(process.env.CERTIFICATE_KEY!);
  const caCert = await AWS.getSecret(process.env.CERTIFICATE!);

  const agent = new https.Agent({
    key: caKey,
    cert: caCert,
  });

  const endpoint = process.env.LAYER7_ENDPOINT;
  const brpApiKey = await AWS.getSecret(process.env.BRP_API_KEY_ARN!);

  const resp = axios.post(
    endpoint || '',
    content,
    {
      method: 'POST',
      httpAgent: agent,
      headers: {
        'Content-type': 'application/json',
        'X-API-KEY': brpApiKey,
      },
    },
  );

  // const response1 = await fetch(
  //   endpoint || '',
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Content-type': 'application/json',
  //       'X-API-KEY': brpApiKey,
  //     },
  //     body: content,
  //   });

  const data = (await resp).data;
  console.log(data);
  return {
    statusCode: (await resp).status,
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  };

}

export async function zoekMetGeslachtsnaamEnGeboortedatum(request: any) {

  const content = {
    type: 'ZoekMetGeslachtsnaamEnGeboortedatum',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    geboortedatum: request.geboortedatum, //'1964-09-24',
    geslachtsnaam: request.geslachtsnaam, //'Vries',
    geslacht: request.geslacht, //'V',
    voorvoegsel: request.voorvoegsel, //'de',
    voornamen: request.voornamen, //'Dirk',
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetNaamEnGemeenteVanInschrijving(request: any) {

  const content = {
    type: 'ZoekMetNaamEnGemeenteVanInschrijving',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    geslacht: request.geslacht, //'V',
    geslachtsnaam: request.geslachtsnaam, //'Vries',
    voorvoegsel: request.voorvoegsel, //'de',
    voornamen: request.voornamen, //'Dirk',
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
    type: request.type, //'RaadpleegMetBurgerservicenummer',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    burgerservicenummer: bsnList,
  };

  return callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetPostcodeEnHuisnummer(request: any) {

  const content = {
    type: 'ZoekMetPostcodeEnHuisnummer',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518', // TODO: Make optional
    inclusiefOverledenPersonen: true,
    huisletter: request.huisletter, //'a',
    huisnummer: request.huisnummer, //14,
    huisnummertoevoeging: request.huisnummertoevoeging, //'bis',
    postcode: request.postcode, //'2341SX',
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetStraatHuisnummerEnGemeenteVanInschrijving(request: any) {

  const content = {
    type: 'ZoekMetStraatHuisnummerEnGemeenteVanInschrijving',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    huisletter: request.huisletter, //'a',
    huisnummer: request.huisnummer, //14,
    huisnummertoevoeging: request.huisnummertoevoeging, //'bis',
    straat: request.straat, //'Tulpstraat',
  };

  await callHaalCentraal(JSON.stringify(content) );


}

export async function zoekMetNummeraanduidingIdentificatie(request: any) {

  const content = {
    type: 'ZoekMetNummeraanduidingIdentificatie',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    nummeraanduidingIdentificatie: request.nummeraanduidingIdentificatie, //'0518200000366054',
  };

  await callHaalCentraal(JSON.stringify(content) );


}

export async function zoekMetAdresseerbaarObjectIdentificatie(request: any) {

  const content = {
    type: 'ZoekMetAdresseerbaarObjectIdentificatie',
    fields: request.fields, //['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    adresseerbaarObjectIdentificatie: request.adresseerbaarObjectIdentificatie, //'0226010000038820',
  };

  await callHaalCentraal(JSON.stringify(content) );

}