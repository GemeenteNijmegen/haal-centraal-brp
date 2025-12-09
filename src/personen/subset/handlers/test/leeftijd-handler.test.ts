import { LeeftijdHandler } from '../leeftijd-handler';

describe('LeeftijdHandler', () => {
  let handler: LeeftijdHandler;

  beforeEach(() => {
    handler = new LeeftijdHandler();
  });

  describe('getFields', () => {
    it('should return burgerservicenummer and leeftijd fields', () => {
      const fields = handler.getFields();

      expect(fields).toEqual(['burgerservicenummer', 'leeftijd']);
      expect(fields).toHaveLength(2);
    });
  });

  describe('processResponse', () => {
    it('should return leeftijd when personData contains leeftijd', () => {
      const personData = {
        leeftijd: 25,
      };

      const result = handler.processResponse(personData);

      expect(result).toEqual({
        leeftijd: 25,
      });
    });

    it('should return undefined when personData has no leeftijd', () => {
      const personData = {};

      const result = handler.processResponse(personData);

      expect(result).toEqual({
        leeftijd: undefined,
      });
    });

    it('should pass through leeftijd value as-is from personData', () => {
      const personData = {
        leeftijd: 42,
        naam: 'Jan Jansen',
        burgerservicenummer: '123456789',
      };

      const result = handler.processResponse(personData);

      expect(result).toEqual({
        leeftijd: 42,
      });
      expect(result).not.toHaveProperty('naam');
      expect(result).not.toHaveProperty('burgerservicenummer');
    });

    it('should handle various age values', () => {
      const testCases = [
        { input: 0, expected: 0 },
        { input: 1, expected: 1 },
        { input: 18, expected: 18 },
        { input: 65, expected: 65 },
        { input: 100, expected: 100 },
      ];

      testCases.forEach(({ input, expected }) => {
        const personData = { leeftijd: input };
        const result = handler.processResponse(personData);
        expect(result.leeftijd).toBe(expected);
      });
    });
  });
});