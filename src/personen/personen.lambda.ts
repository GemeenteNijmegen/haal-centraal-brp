import * as https from 'https';
import { Bsn, AWS } from '@gemeentenijmegen/utils';
import axios from 'axios';

export async function handler (event: any, _context: any):Promise<any> {
  // console.log(event);

  // console.log('parse: ');
  const request = JSON.parse(event.body);
  // console.log(request);

  // console.log('read: ');
  // console.log(request.type);

  const validProfile = validateProfile(request.fields, 'testApp'); //TODO: testApp can be api-key or certificate or any other way to identify the application.

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

export async function validateProfile(fields: [], applicationId: string) {
  const profile = new Set(await getProfile(applicationId));
  const check = fields.every(field => profile.has(field)); // Validate if every field in fields is part of the allowed fields in the profile.
  return check;
}

export async function getProfile(applicationId: string) {
  //TODO: get profile config file related to the application and return the fields
  if (applicationId == 'testApp') {
    console.log(applicationId);
  }
  return ['aNummer', 'adressering', 'burgerservicenummer']; //PLACEHOLDER: returns a list of all allowed fields
}

export async function callHaalCentraal(content: string) {
  //process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; //TODO Remove

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