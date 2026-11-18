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

describe('ApiStack audit log', () => {
  const app = new App();
  const stack = new ApiStack(app, 'api', { env: mockEnv, configuration: config });
  const template = Template.fromStack(stack);

  test('has an audit log table keyed by hashed BSN and time', () => {
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
  ])('request lambda %s gets the audit log configuration', (description) => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Description: description,
      Environment: {
        Variables: Match.objectLike({
          AUDIT_LOG_TABLE_NAME: Match.anyValue(),
          BSN_HASH_SALT_ARN: Match.anyValue(),
          ENFORCE_AUDIT_LOG_HEADERS: 'false',
        }),
      },
    });
  });

  test('request lambdas can write to the audit log table', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'dynamodb:BatchWriteItem',
              Resource: Match.arrayWith([{ 'Fn::GetAtt': [Match.stringLikeRegexp('auditlog'), 'Arn'] }]),
            }),
          ]),
        },
      },
    });
    expect(Object.keys(policies)).toHaveLength(3);
  });

  test('request lambdas cannot update or delete single audit log records', () => {
    const statements = Object.values(template.findResources('AWS::IAM::Policy'))
      .flatMap((policy: any) => policy.Properties.PolicyDocument.Statement)
      .filter((statement: any) => JSON.stringify(statement.Resource).includes('auditlog'));
    const actions = statements.flatMap((statement: any) => [statement.Action].flat());
    expect(actions).toContain('dynamodb:BatchWriteItem');
    expect(actions).not.toContain('dynamodb:DeleteItem');
    expect(actions).not.toContain('dynamodb:UpdateItem');
  });
});
