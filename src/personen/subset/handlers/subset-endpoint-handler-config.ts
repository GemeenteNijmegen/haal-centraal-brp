import { KinderenPartnersHandler } from './kinderen-partners-handler';
import { LeeftijdHandler } from './leeftijd-handler';
import { NederlandsHandler } from './nederlands-handler';
import { SubsetHandler } from './subset-handler';

export interface SubsetEndpointConfig {
  path: string;
  handlerClass: new () => SubsetHandler;
}

export const SUBSET_ENDPOINTS: SubsetEndpointConfig[] = [
  {
    path: 'leeftijd',
    handlerClass: LeeftijdHandler,
  },
  {
    path: 'kinderen-partners',
    handlerClass: KinderenPartnersHandler,
  },
  {
    path: 'nederlands',
    handlerClass: NederlandsHandler,
  },
];