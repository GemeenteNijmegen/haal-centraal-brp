import { SubsetHandler } from '../subset-handler';

class TestHandler extends SubsetHandler {
  constructor(private additionalFields: string[] = ['testField']) {
    super();
  }

  protected getAdditionalFields(): string[] {
    return this.additionalFields;
  }

  processResponse(personData: any): any {
    return {
      processed: true,
      data: personData,
    };
  }
}

describe('SubsetHandler', () => {
  describe('getFields', () => {
    it('should return burgerservicenummer and additional fields', () => {
      const handler = new TestHandler(['field1', 'field2']);

      const result = handler.getFields();

      expect(result).toEqual(['burgerservicenummer', 'field1', 'field2']);
    });

    it('should return only burgerservicenummer when no additional fields', () => {
      const handler = new TestHandler([]);

      const result = handler.getFields();

      expect(result).toEqual(['burgerservicenummer']);
    });

    it('should always include burgerservicenummer as first field', () => {
      const handler = new TestHandler(['additionalField']);

      const result = handler.getFields();

      expect(result[0]).toBe('burgerservicenummer');
      expect(result).toHaveLength(2);
    });

    it('should handle single additional field', () => {
      const handler = new TestHandler(['leeftijd']);

      const result = handler.getFields();

      expect(result).toEqual(['burgerservicenummer', 'leeftijd']);
    });

    it('should handle multiple additional fields', () => {
      const handler = new TestHandler(['kinderen', 'partners', 'nationaliteiten']);

      const result = handler.getFields();

      expect(result).toEqual(['burgerservicenummer', 'kinderen', 'partners', 'nationaliteiten']);
      expect(result).toHaveLength(4);
    });

    it('should maintain order of additional fields', () => {
      const fields = ['field3', 'field1', 'field2'];
      const handler = new TestHandler(fields);

      const result = handler.getFields();

      expect(result).toEqual(['burgerservicenummer', 'field3', 'field1', 'field2']);
    });
  });

  describe('processResponse', () => {
    it('should be implemented by subclass', () => {
      const handler = new TestHandler();
      const personData = { naam: 'Test' };

      const result = handler.processResponse(personData);

      expect(result).toBeDefined();
      expect(result.processed).toBe(true);
      expect(result.data).toEqual(personData);
    });
  });
});

