import { EndpointNotFoundError } from '../../errors/subset-errors';
import { KinderenPartnersHandler } from '../kinderen-partners-handler';
import { LeeftijdHandler } from '../leeftijd-handler';
import { NederlandsHandler } from '../nederlands-handler';
import { SUBSET_ENDPOINTS } from '../subset-endpoint-handler-config';
import { SubsetHandler } from '../subset-handler';
import { SubsetHandlerFactory } from '../subset-handler-factory';

describe('HandlerFactory', () => {
  beforeEach(() => {
    SubsetHandlerFactory.clearCache();
  });

  describe('getHandler', () => {
    it('should return LeeftijdHandler for leeftijd endpoint', () => {
      const handler = SubsetHandlerFactory.getHandler('leeftijd');

      expect(handler).toBeInstanceOf(LeeftijdHandler);
    });

    it('should return KinderenPartnersHandler for kinderen-partners endpoint', () => {
      const handler = SubsetHandlerFactory.getHandler('kinderen-partners');

      expect(handler).toBeInstanceOf(KinderenPartnersHandler);
    });

    it('should return NederlandsHandler for nederlands endpoint', () => {
      const handler = SubsetHandlerFactory.getHandler('nederlands');

      expect(handler).toBeInstanceOf(NederlandsHandler);
    });

    it('should cache handler after first call', () => {
      const firstCall = SubsetHandlerFactory.getHandler('leeftijd');
      const secondCall = SubsetHandlerFactory.getHandler('leeftijd');

      expect(firstCall).toBe(secondCall);
    });

    it('should create separate instances for different endpoints', () => {
      const leeftijdHandler = SubsetHandlerFactory.getHandler('leeftijd');
      const nederlandsHandler = SubsetHandlerFactory.getHandler('nederlands');

      expect(leeftijdHandler).not.toBe(nederlandsHandler);
    });

    it('should throw EndpointNotFoundError for unknown endpoint', () => {
      expect(() => SubsetHandlerFactory.getHandler('onbekend-endpoint')).toThrow(EndpointNotFoundError);
    });
  });

  describe('clearCache for testing', () => {
    it('should clear cached handlers', () => {
      const firstHandler = SubsetHandlerFactory.getHandler('leeftijd');

      SubsetHandlerFactory.clearCache();

      const secondHandler = SubsetHandlerFactory.getHandler('leeftijd');

      expect(firstHandler).not.toBe(secondHandler);
    });
  });
  describe('error handling instantiate', () => {
    it('should throw error when handler initialization fails', () => {
      class BrokenHandler extends SubsetHandler {
        constructor() {
          super();
          throw new Error('Constructor failed');
        }

        protected getAdditionalFields(): string[] {
          return [];
        }

        processResponse(): any {
          return {};
        }
      }

      jest.spyOn(SUBSET_ENDPOINTS, 'find').mockReturnValue({
        path: 'broken',
        handlerClass: BrokenHandler,
      });

      expect(() => SubsetHandlerFactory.getHandler('broken'))
        .toThrow('Failed to initialize handler for endpoint broken: Error: Constructor failed');
    });

  });
});