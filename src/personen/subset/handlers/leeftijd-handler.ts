import { SubsetHandler } from './subset-handler';

export class LeeftijdHandler extends SubsetHandler {
  protected getAdditionalFields(): string[] {
    return [
      'leeftijd',
    ];
  }

  // Hier eventueel later toevoegen omgaan met geboortedatums die onvolledig of onbekend zijn.
  // Leeftijdveld uit haalcentraal kan namelijk nog niet omgaan met onvolledige geboortedatums (ongeveer 70000 personen)
  //https://puc.overheid.nl/svb/doc/PUC_1001_20/
  // https://www.binnenlandsbestuur.nl/bestuur-en-organisatie/verordening/niet-bestaande-geboortedatum-00-00-jj-blijft-probleem
  //https://developer.rvig.nl/brp-api/personen/features/leeftijd/

  processResponse(personData: any): any {
    return {
      leeftijd: personData.leeftijd,
    };
  }
}