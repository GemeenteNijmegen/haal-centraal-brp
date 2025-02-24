import { DynamoDB } from 'aws-sdk';
import { initSecrets, PersonenSecrets } from '../initSecrets';
import { validateFields, getAllowedFields } from '../personen.lambda'; // Handler import done later on to mock initSecrets


jest.mock('node-fetch', () => jest.fn());
jest.mock('../initSecrets'); // Set mockResolve seperately to prevent unused import


let mockDBGet = jest.fn().mockImplementation(() => ({
  promise: jest.fn().mockResolvedValue({ Item: { fields: { values: ['field1', 'field2'] } } }),
}));

jest.mock('aws-sdk', () => {
  return {
    DynamoDB: {
      DocumentClient: jest.fn(() => ({
        get: mockDBGet,
      })),
    },
  };
});

describe('validateFields', () => {
  it('should return true when all fields are allowed', async () => {
    const idTable = new DynamoDB.DocumentClient();
    const receivedFields = ['field1'];
    const applicationId = 'app-id'; //TODO

    const result = await validateFields(receivedFields, applicationId, idTable);
    expect(result).toBe(true);
  });

  it('should return false when some fields are not allowed', async () => {
    const idTable = new DynamoDB.DocumentClient();
    const receivedFields = ['field3'];
    const applicationId = 'app-id'; //TODO

    const result = await validateFields(receivedFields, applicationId, idTable);
    expect(result).toBe(false);
  });
});

describe('getAllowedFields', () => {
  it('should return allowed fields for a given API key', async () => {
    const idTable = new DynamoDB.DocumentClient();
    const apiKey = 'test-api-key'; //TODO

    process.env.ID_TABLE_NAME = 'TestTable'; //TODO

    const fields = await getAllowedFields(apiKey, idTable);
    expect(fields).toEqual(['field1', 'field2']);
  });

  it('should handle missing data gracefully', async () => {
    mockDBGet.mockImplementationOnce(() => ({
      promise: jest.fn().mockResolvedValue({}), // No Item field
    }));
    const idTable = new DynamoDB.DocumentClient();
    const apiKey = 'test-api-key'; //TODO
    process.env.ID_TABLE_NAME = 'TestTable'; //TODO
    const fields = await getAllowedFields(apiKey, idTable);
    expect(fields).toBeUndefined();
  });
});

describe('handler', () => {
  let handler: any;
  beforeEach(async () => {
    (initSecrets as jest.Mock).mockResolvedValue({} as any as PersonenSecrets);
    // Re-import handler to use mocked secrets, move more to the top if more handler calls are made
    jest.resetModules();
    const importedModule = (await import('../personen.lambda')); // should load after mock secrets, otherwise cannot set mock above handler
    handler = importedModule.handler;
  });
  it('should return 403 for invalid fields', async () => {
    const event = {
      body: JSON.stringify({ fields: ['invalidField'] }),
      requestContext: { identity: { apiKey: 'test-api-key' } }, //TODO
    };
    const result = await handler(event);
    expect(result.statusCode).toBe('403');
    expect(result.body).toBe('Mismatch in application/profile');
  });
});

