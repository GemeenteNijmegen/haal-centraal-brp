import { SubsetHandler } from './subset-handler';

export class NederlandsHandler extends SubsetHandler {
  protected getAdditionalFields(): string[] {
    return [
      'nationaliteiten',
    ];
  }

  processResponse(persoon: any): any {

    // TODO: nationaliteit haalcentraal type BehandeldAlsNederlander uitzoeken
    // https://developer.rvig.nl/brp-api/personen/specificatie/#operation/Personen

    // Doel van veld is teruggeven wanneer we vanuit de BRP zeker weten dat iemand bij nationaliteiten Nederlandse heeft
    // Bij twijfel, foutmeldingen ophalen data in beginsel op false.
    // Kortom: een false betekent niet dat iemand niet Nederlands is.
    // Een true betekent dat geverifieerd kan worden dat iemand Nederlandse nationaliteit heeft.
    // Net als andere brp-data, alleen op te halen met doelbinding en dus wettelijke grondslag
    // Data over alle nationaliteiten is in de meeste gevallen te breed en onnodig, daarom deze privacyvriendelijke versie.
    // Doel met wettelijke grondslag bereiken met minimale data
    // tabel rvig met code en omschrijving https://publicaties.rvig.nl/

    let heeftNederlandseNationaliteit = false;

    if (persoon?.nationaliteiten && Array.isArray(persoon.nationaliteiten)) {
      heeftNederlandseNationaliteit = persoon.nationaliteiten.some(
        (nat: any) => nat?.nationaliteit?.omschrijving === 'Nederlandse',
      );
    }
    return {
      nederlands: heeftNederlandseNationaliteit,
    };
  }
}