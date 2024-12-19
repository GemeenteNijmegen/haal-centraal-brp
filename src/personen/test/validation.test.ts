import { DynamoDB } from 'aws-sdk';
import { validateFields, getAllowedFields, handler } from '../personen.lambda';

jest.mock('aws-sdk', () => {
  const mockGet = jest.fn().mockImplementation(() => ({
    promise: jest.fn().mockResolvedValue({ Item: { fields: { values: ['field1', 'field2'] } } }),
  }));

  return {
    DynamoDB: {
      DocumentClient: jest.fn(() => ({
        get: mockGet,
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
    jest.mock('aws-sdk', () => ({
      DynamoDB: {
        DocumentClient: jest.fn(() => ({
          get: jest.fn(() => ({
            promise: jest.fn().mockResolvedValue({}),
          })),
        })),
      },
    }));

    const idTable = new DynamoDB.DocumentClient();
    const apiKey = 'test-api-key'; //TODO

    process.env.ID_TABLE_NAME = 'TestTable'; //TODO

    const fields = await getAllowedFields(apiKey, idTable);
    expect(fields).toBeUndefined();
  });
});

describe('handler', () => {
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

