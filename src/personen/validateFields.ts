import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient();

/**
 * Validate if every field in the received fields is part of the allowed fields in the profile.
 * @param receivedFields Fields received from the original request
 * @param profileFields The application fields form the profile number (api key)
 * @returns Wether or not the given fields in the request are allowed by the specific application
 */
export function validateFields(receivedFields: string[], profileFields: string[]) {
  const allowedFields = new Set(profileFields);
  const check = receivedFields.every(receivedField => allowedFields.has(receivedField));
  return check;
}

export async function getApplicationProfile(apiKey: string) {
  const tableName = process.env.ID_TABLE_NAME!;

  const data = await dynamodb.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      id: { S: apiKey },
    },
  }));

  if (!data.Item) {
    throw Error('Unknown application/profile');
  }

  return {
    fields: data.Item?.fields.SS ?? [],
    name: data.Item?.name.S ?? 'Unknown',
  };
}