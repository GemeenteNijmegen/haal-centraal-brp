import { NederlandsHandler } from '../nederlands-handler';

describe('NederlandsHandler', () => {
  let handler: NederlandsHandler;

  beforeEach(() => {
    handler = new NederlandsHandler();
  });

  describe('getFields', () => {
    it('should return burgerservicenummer and nationaliteiten fields', () => {
      const fields = handler.getFields();
      expect(fields).toEqual(['burgerservicenummer', 'nationaliteiten']);
      expect(fields).toHaveLength(2);
    });
  });

  describe('processResponse', () => {
    it('should return true when person has Nederlandse nationaliteit', () => {
      const persoon = {
        nationaliteiten: [
          {
            nationaliteit: {
              code: '0001',
              omschrijving: 'Nederlandse',
            },
          },
        ],
      };
      const result = handler.processResponse(persoon);
      expect(result).toEqual({
        nederlands: true,
      });
    });

    describe('should ignore type field and only check omschrijving for Nederlandse', () => {
      const testCases = [
        {
          description: 'with type Nationaliteit',
          nationaliteit: {
            type: 'Nationaliteit',
            code: '0001',
            omschrijving: 'Nederlandse',
          },
        },
        {
          description: 'with type BehandeldAlsNederlander',
          nationaliteit: {
            type: 'BehandeldAlsNederlander',
            code: '0001',
            omschrijving: 'Nederlandse',
          },
        },
        {
          description: 'with type VastgesteldNietNederlander',
          nationaliteit: {
            type: 'VastgesteldNietNederlander',
            code: '0001',
            omschrijving: 'Nederlandse',
          },
        },
        {
          description: 'without type field',
          nationaliteit: {
            code: '0001',
            omschrijving: 'Nederlandse',
          },
        },
      ];

      testCases.forEach(({ description, nationaliteit }) => {
        it(description, () => {
          const persoon = {
            nationaliteiten: [{ nationaliteit }],
          };
          const result = handler.processResponse(persoon);
          expect(result.nederlands).toBe(true);
        });
      });
    });

    describe('should return false for invalid or missing data', () => {
      const falseTestCases = [
        {
          description: 'when person has no nationaliteiten',
          persoon: {},
        },
        {
          description: 'when nationaliteiten is null',
          persoon: { nationaliteiten: null },
        },
        {
          description: 'when nationaliteiten is undefined',
          persoon: { nationaliteiten: undefined },
        },
        {
          description: 'when nationaliteiten is empty array',
          persoon: { nationaliteiten: [] },
        },
        {
          description: 'when nationaliteiten is not an array',
          persoon: { nationaliteiten: 'not-an-array' },
        },
        {
          description: 'when nationaliteit object is missing omschrijving',
          persoon: {
            nationaliteiten: [
              {
                nationaliteit: {
                  code: '0001',
                },
              },
            ],
          },
        },
        {
          description: 'when nationaliteit object is null',
          persoon: {
            nationaliteiten: [
              {
                nationaliteit: null,
              },
            ],
          },
        },
        {
          description: 'when nationaliteiten entry is malformed',
          persoon: {
            nationaliteiten: [{}],
          },
        },
      ];

      falseTestCases.forEach(({ description, persoon }) => {
        it(description, () => {
          const result = handler.processResponse(persoon);
          expect(result).toEqual({
            nederlands: false,
          });
        });
      });
    });

    describe('should handle foreign nationaliteiten', () => {
      const foreignNationaliteitTestCases = [
        {
          description: 'single Belgische nationaliteit',
          nationaliteiten: [
            {
              nationaliteit: {
                code: '0027',
                omschrijving: 'Belgische',
              },
            },
          ],
        },
        {
          description: 'multiple foreign nationaliteiten',
          nationaliteiten: [
            {
              nationaliteit: {
                code: '0027',
                omschrijving: 'Belgische',
              },
            },
            {
              nationaliteit: {
                code: '0052',
                omschrijving: 'Duitse',
              },
            },
          ],
        },
      ];

      foreignNationaliteitTestCases.forEach(({ description, nationaliteiten }) => {
        it(`should return false when person has ${description}`, () => {
          const persoon = { nationaliteiten };
          const result = handler.processResponse(persoon);
          expect(result).toEqual({
            nederlands: false,
          });
        });
      });
    });

    describe('should handle dual nationality scenarios', () => {
      const dualNationalityTestCases = [
        {
          description: 'Nederlandse as first listed nationality',
          nationaliteiten: [
            {
              nationaliteit: {
                code: '0001',
                omschrijving: 'Nederlandse',
              },
            },
            {
              nationaliteit: {
                code: '0027',
                omschrijving: 'Belgische',
              },
            },
          ],
        },
        {
          description: 'Nederlandse as second listed nationality',
          nationaliteiten: [
            {
              nationaliteit: {
                code: '0027',
                omschrijving: 'Belgische',
              },
            },
            {
              nationaliteit: {
                code: '0001',
                omschrijving: 'Nederlandse',
              },
            },
          ],
        },
        {
          description: 'Nederlandse in the middle of multiple nationaliteiten',
          nationaliteiten: [
            {
              nationaliteit: {
                code: '0027',
                omschrijving: 'Belgische',
              },
            },
            {
              nationaliteit: {
                code: '0001',
                omschrijving: 'Nederlandse',
              },
            },
            {
              nationaliteit: {
                code: '0052',
                omschrijving: 'Duitse',
              },
            },
          ],
        },
      ];

      dualNationalityTestCases.forEach(({ description, nationaliteiten }) => {
        it(`should return true when ${description}`, () => {
          const persoon = { nationaliteiten };
          const result = handler.processResponse(persoon);
          expect(result).toEqual({
            nederlands: true,
          });
        });
      });
    });

    it('should handle Nederlandse with additional properties', () => {
      const persoon = {
        nationaliteiten: [
          {
            nationaliteit: {
              code: '0001',
              omschrijving: 'Nederlandse',
            },
            datumIngangGeldigheid: {
              datum: '2000-01-01',
            },
            redenOpname: {
              code: '301',
              omschrijving: 'RedenOpname',
            },
          },
        ],
      };
      const result = handler.processResponse(persoon);
      expect(result).toEqual({
        nederlands: true,
      });
    });
  });
});