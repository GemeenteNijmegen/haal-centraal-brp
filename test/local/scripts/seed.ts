import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { localConfig } from '../cdk/localConfig';

/**
 * Write the profile of every local application to the applications table,
 * keyed by its API key like in production (see docs/Beheer.md).
 * Uses AWS_ENDPOINT_URL and the test credentials set by scripts/local.sh.
 */
async function seed() {
  const dynamodb = new DynamoDBClient({ region: localConfig.region });
  for (const application of localConfig.applications) {
    await dynamodb.send(new PutItemCommand({
      TableName: localConfig.tables.applications,
      Item: {
        id: { S: application.apiKey },
        name: { S: application.name },
        fields: { SS: application.fields },
      },
    }));
    console.log(`Seeded application ${application.name}`);
  }
}

seed().catch(error => {
  console.error(error);
  process.exit(1);
});
