import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getAllowedFields, handler, validateFields } from '../personen.lambda'; // Handler import done later on to mock initSecrets

jest.mock('node-fetch', () => jest.fn());
jest.mock('../initSecrets'); // Set mockResolve seperately to prevent unused import

const ddbMock = mockClient(DynamoDBClient);


describe('validateFields', () => {
  it('should return true when all fields are allowed', async () => {
    const receivedFields = ['field1'];
    const applicationId = 'app-id-test';

    setupGetItemResponse(['field1', 'field2']);

    const result = await validateFields(receivedFields, applicationId);
    expect(result).toBe(true);
  });

  it('should return false when some fields are not allowed', async () => {
    const receivedFields = ['field3'];
    const applicationId = 'app-id-test';

    setupGetItemResponse(['field1', 'field2']);

    const result = await validateFields(receivedFields, applicationId);
    expect(result).toBe(false);
  });
});

describe('getAllowedFields', () => {

  it('should return allowed fields for a given API key', async () => {
    const apiKey = 'test-api-key';
    process.env.ID_TABLE_NAME = 'TestTable';
    setupGetItemResponse(['field1', 'field2']);
    const fields = await getAllowedFields(apiKey);
    expect(fields).toEqual(['field1', 'field2']);
  });

  it('should handle missing data gracefully', async () => {
    setupGetItemResponse(undefined);
    const apiKey = 'test-api-key';
    process.env.ID_TABLE_NAME = 'TestTable';
    const fields = await getAllowedFields(apiKey);
    expect(fields).toBeUndefined();
  });

});

describe('handler', () => {

  it('should return 403 for invalid fields', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1']);
    const event = {
      body: JSON.stringify({ fields: ['invalidField'] }),
      requestContext: { identity: { apiKey: 'test-api-key' } },
    };
    const result = await handler(event);
    expect(result.statusCode).toBe('403');
    expect(result.body).toBe('Mismatch in application/profile');
  });

});


function setupGetItemResponse(fields?: string[]) {
  let getItemOutput: Partial<GetItemCommandOutput> = {
    Item: undefined,
  };

  if (fields) {
    getItemOutput = {
      Item: {
        fields: {
          SS: fields,
        },
      },
    };
  }

  ddbMock.on(GetItemCommand).resolves(getItemOutput);
}

