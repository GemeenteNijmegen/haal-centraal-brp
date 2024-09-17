import { Bsn, AWS } from '@gemeentenijmegen/utils';

export async function handler (event: any, _context: any):Promise<any> {
  console.log(event);

  console.log('parse: ');
  const request = JSON.parse(event.body);
  console.log(request);

  console.log('read: ');
  console.log(request.type);

  switch ( request.type ) {
    case 'ZoekMetGeslachtsnaamEnGeboortedatum':
      await zoekMetGeslachtsnaamEnGeboortedatum();
      break;
    case 'ZoekMetNaamEnGemeenteVanInschrijving':
      await zoekMetNaamEnGemeenteVanInschrijving();
      break;
    case 'RaadpleegMetBurgerservicenummer':
      return raadpleegMetBurgerservicenummer(request);
    case 'ZoekMetPostcodeEnHuisnummer':
      await zoekMetPostcodeEnHuisnummer();
      break;
    case 'ZoekMetStraatHuisnummerEnGemeenteVanInschrijving':
      await zoekMetStraatHuisnummerEnGemeenteVanInschrijving();
      break;
    case 'ZoekMetNummeraanduidingIdentificatie':
      await zoekMetNummeraanduidingIdentificatie();
      break;
    case 'ZoekMetAdresseerbaarObjectIdentificatie':
      await zoekMetAdresseerbaarObjectIdentificatie();
      break;
    default:
      console.log('Unknown Request Type');
      return JSON.stringify('Unknown Request Type');
  }
};

export async function callHaalCentraal(content: string) {
  const endpoint = 'https://proefomgeving.haalcentraal.nl/haalcentraal/api/brp';
  const apiKey = await AWS.getSecret(process.env.BRP_API_KEY!);

  const response = await fetch(endpoint + '/personen',
    {
      method: 'POST',
      headers: {
        'Content-type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: content,
    });

  const data = await response.json() as Promise<any>;

  if ((await data).personen[0].overlijden) {
    throw new Error('Persoon lijkt overleden');
  } else if ((await data).personen[0]) {
    return (await data).personen[0];
  }
}

export async function zoekMetGeslachtsnaamEnGeboortedatum() {

  const content = {
    type: 'ZoekMetGeslachtsnaamEnGeboortedatum',
    fields: ['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    geboortedatum: '1964-09-24',
    geslachtsnaam: 'Vries',
    geslacht: 'V',
    voorvoegsel: 'de',
    voornamen: 'Dirk',
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetNaamEnGemeenteVanInschrijving() {

  const content = {
    type: 'ZoekMetNaamEnGemeenteVanInschrijving',
    fields: ['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    geslacht: 'V',
    geslachtsnaam: 'Vries',
    voorvoegsel: 'de',
    voornamen: 'Dirk',
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

export async function zoekMetPostcodeEnHuisnummer() {

  const content = {
    type: 'ZoekMetPostcodeEnHuisnummer',
    fields: ['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    huisletter: 'a',
    huisnummer: 14,
    huisnummertoevoeging: 'bis',
    postcode: '2341SX',
  };

  await callHaalCentraal(JSON.stringify(content) );

}

export async function zoekMetStraatHuisnummerEnGemeenteVanInschrijving() {

  const content = {
    type: 'ZoekMetStraatHuisnummerEnGemeenteVanInschrijving',
    fields: ['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    huisletter: 'a',
    huisnummer: 14,
    huisnummertoevoeging: 'bis',
    straat: 'Tulpstraat',
  };

  await callHaalCentraal(JSON.stringify(content) );


}

export async function zoekMetNummeraanduidingIdentificatie() {

  const content = {
    type: 'ZoekMetNummeraanduidingIdentificatie',
    fields: ['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    nummeraanduidingIdentificatie: '0518200000366054',
  };

  await callHaalCentraal(JSON.stringify(content) );


}

export async function zoekMetAdresseerbaarObjectIdentificatie() {

  const content = {
    type: 'ZoekMetAdresseerbaarObjectIdentificatie',
    fields: ['aNummer', 'adressering', 'burgerservicenummer', 'datumEersteInschrijvingGBA', 'datumInschrijvingInGemeente', 'europeesKiesrecht', 'geboorte', 'gemeenteVanInschrijving', 'geslacht', 'gezag', 'immigratie', 'indicatieCurateleRegister', 'indicatieGezagMinderjarige', 'kinderen', 'leeftijd', 'naam', 'nationaliteiten', 'ouders', 'overlijden', 'partners', 'uitsluitingKiesrecht', 'verblijfplaats', 'verblijfstitel', 'verblijfplaatsBinnenland', 'adresseringBinnenland'],
    gemeenteVanInschrijving: '0518',
    inclusiefOverledenPersonen: true,
    adresseerbaarObjectIdentificatie: '0226010000038820',
  };

  await callHaalCentraal(JSON.stringify(content) );

}