import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../personen.lambda'; // Handler import done later on to mock initSecrets
import { handler as handlerSubset } from '../subset/subset.lambda';
import { getApplicationProfile, validateFields } from '../validateFields';

jest.mock('node-fetch', () => jest.fn());
jest.mock('../initSecrets'); // Set mockResolve seperately to prevent unused import

const ddbMock = mockClient(DynamoDBClient);


describe('validateFields', () => {
  it('should return true when all fields are allowed', async () => {
    const receivedFields = ['field1'];
    const result = validateFields(receivedFields, receivedFields);
    expect(result).toBe(true);
  });

  it('should return false when some fields are not allowed', async () => {
    const receivedFields = ['field3'];
    const profileFields = ['app-id-test'];
    const result = validateFields(receivedFields, profileFields);
    expect(result).toBe(false);
  });
});

describe('getAllowedFields', () => {

  it('should return allowed fields for a given API key', async () => {
    const apiKey = 'test-api-key';
    process.env.ID_TABLE_NAME = 'TestTable';
    setupGetItemResponse(['field1', 'field2'], 'test-api-key');
    const profile = await getApplicationProfile(apiKey);
    expect(profile.fields).toEqual(['field1', 'field2']);
  });

  it('should handle missing data gracefully', async () => {
    setupGetItemResponse(undefined, 'test-api-key');
    const apiKey = 'test-api-key';
    process.env.ID_TABLE_NAME = 'TestTable';
    const profile = getApplicationProfile(apiKey);
    await expect(profile).rejects.toThrow('Unknown application/profile');
  });

});

describe('handler', () => {

  it('should return 403 for invalid fields', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1'], 'app1');
    const event = {
      body: JSON.stringify({ fields: ['invalidField'] }),
      requestContext: { identity: { apiKey: 'test-api-key' } },
    };
    const result = await handler(event);
    expect(result.statusCode).toBe('403');
    expect(result.body).toBe('Mismatch in application/profile');
  });

});

describe('handlersubset', () => {

  it('should return 403 for invalid fields', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    setupGetItemResponse(['field1'], 'app1');

    const event = {
      body: JSON.stringify({ fields: ['invalidField'] }),
      requestContext: { identity: { apiKey: 'test-api-key' } },
    };

    const result = await handlerSubset(event);
    expect(result.statusCode).toBe('403');
    expect(result.body).toBe('Mismatch in application/profile');
  });

});


function setupGetItemResponse(fields: string[] | undefined, name: string) {
  let getItemOutput: Partial<GetItemCommandOutput> = {
    Item: undefined,
  };

  if (fields) {
    getItemOutput = {
      Item: {
        fields: {
          SS: fields,
        },
        name: {
          S: name,
        },
      },
    };
  }

  ddbMock.on(GetItemCommand).resolves(getItemOutput);
}

