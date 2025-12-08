import { KinderenPartnersHandler } from '../kinderen-partners-handler';

describe('KinderenPartnersHandler', () => {
  let handler: KinderenPartnersHandler;

  beforeEach(() => {
    handler = new KinderenPartnersHandler();
  });

  describe('getAdditionalFields', () => {
    it('should return partners and kinderen fields', () => {
      const fields = handler.getAdditionalFields();

      expect(fields).toEqual(['partners', 'kinderen']);
      expect(fields).toHaveLength(2);
    });
  });

  describe('processResponse', () => {
    it('should return false for both kinderen and partners when persoon has no data', () => {
      const persoon = {};

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: false,
        partners: false,
      });
    });

    it('should return true for kinderen when persoon has kinderen array with items', () => {
      const persoon = {
        kinderen: [
          { burgerservicenummer: '123456789' },
        ],
      };

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: true,
        partners: false,
      });
    });

    it('should return true for partners when persoon has partners array with items', () => {
      const persoon = {
        partners: [
          { burgerservicenummer: '987654321' },
        ],
      };

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: false,
        partners: true,
      });
    });

    it('should return true for both when persoon has both kinderen and partners', () => {
      const persoon = {
        kinderen: [
          { burgerservicenummer: '123456789' },
        ],
        partners: [
          { burgerservicenummer: '987654321' },
        ],
      };

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: true,
        partners: true,
      });
    });

    it('should return false for kinderen when array is empty', () => {
      const persoon = {
        kinderen: [],
        partners: [
          { burgerservicenummer: '987654321' },
        ],
      };

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: false,
        partners: true,
      });
    });

    it('should return false for partners when array is empty', () => {
      const persoon = {
        kinderen: [
          { burgerservicenummer: '123456789' },
        ],
        partners: [],
      };

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: true,
        partners: false,
      });
    });

    it('should return false for both when arrays are empty', () => {
      const persoon = {
        kinderen: [],
        partners: [],
      };

      const result = handler.processResponse(persoon);

      expect(result).toEqual({
        kinderen: false,
        partners: false,
      });
    });

    it('should handle multiple kinderen entries', () => {
      const persoon = {
        kinderen: [
          { burgerservicenummer: '111111111' },
          { burgerservicenummer: '222222222' },
          { burgerservicenummer: '333333333' },
        ],
      };

      const result = handler.processResponse(persoon);

      expect(result.kinderen).toBe(true);
    });

    it('should handle multiple partners entries', () => {
      const persoon = {
        partners: [
          { burgerservicenummer: '111111111' },
          { burgerservicenummer: '222222222' },
        ],
      };

      const result = handler.processResponse(persoon);

      expect(result.partners).toBe(true);
    });
  });
});