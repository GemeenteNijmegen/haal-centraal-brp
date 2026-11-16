import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../src/ApiStack';
import { Configuration } from '../src/Configuration';
import { ParameterStack } from '../src/ParameterStack';
import { PipelineStack } from '../src/PipelineStack';


const mockEnv = {
  account: '123456789012',
  region: 'eu-central-1',
};

const config: Configuration = {
  branch: 'test',
  buildEnvironment: mockEnv,
  deploymentEnvironment: mockEnv,
  devMode: true,
};

test('Snapshot', () => {
  const app = new App();
  const stack = new PipelineStack(app, 'test', { env: mockEnv, configuration: config });
  const template = Template.fromStack(stack);
  expect(template.toJSON()).toMatchSnapshot();
});

test('StackHasParameters', () => {
  const app = new App();
  const stack = new ParameterStack(app, 'test');
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::SSM::Parameter', 1);
});

test('ParameterStack generates a retained BSN hash salt', () => {
  const app = new App();
  const stack = new ParameterStack(app, 'test');
  const template = Template.fromStack(stack);
  template.hasResource('AWS::SecretsManager::Secret', {
    Properties: {
      Name: '/cdk/haal-centraal-brp/bsn-hash-salt',
      GenerateSecretString: Match.objectLike({ PasswordLength: 64 }),
    },
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
});

describe('ApiStack request log', () => {
  const app = new App();
  const stack = new ApiStack(app, 'api', { env: mockEnv, configuration: config });
  const template = Template.fromStack(stack);

  test('has a request log table keyed by hashed BSN and time', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      Properties: {
        KeySchema: [
          { AttributeName: 'bsnHash', KeyType: 'HASH' },
          { AttributeName: 'requestedAt', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        DeletionProtectionEnabled: true,
        TimeToLiveSpecification: Match.absent(),
      },
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test.each([
    'HAAL CENTRAAL Persoonen endpoint function',
    'src/personen/subset/subset.lambda.ts',
    'src/personen/partner-filter/partner-filter.lambda.ts',
  ])('request lambda %s gets the request log configuration', (description) => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: description,
      Environment: {
        Variables: Match.objectLike({
          REQUEST_LOG_TABLE_NAME: Match.anyValue(),
          BSN_HASH_SALT_ARN: Match.anyValue(),
          REQUIRE_REQUEST_LOG_HEADERS: 'false',
        }),
      },
    });
  });

  test('request lambdas can write to the request log table', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['dynamodb:BatchWriteItem']),
              Resource: Match.arrayWith([{ 'Fn::GetAtt': [Match.stringLikeRegexp('requestlog'), 'Arn'] }]),
            }),
          ]),
        },
      },
    });
    expect(Object.keys(policies)).toHaveLength(3);
  });
});
