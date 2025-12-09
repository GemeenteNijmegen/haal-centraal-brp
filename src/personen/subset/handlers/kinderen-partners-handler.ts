import { SubsetHandler } from './subset-handler';

export class KinderenPartnersHandler extends SubsetHandler {
  getAdditionalFields(): string[] {
    return [
      'partners',
      'kinderen',
    ];
  }

  processResponse(persoon: any): any {
    let hasKinderen = false;
    let hasPartners = false;

    if (persoon.kinderen && persoon.kinderen.length > 0) {
      hasKinderen = true;
    }

    if (persoon.partners && persoon.partners.length > 0) {
      hasPartners = true;
    };

    const responseBody = {
      kinderen: hasKinderen,
      partners: hasPartners,
    };
    return responseBody;
  }
}