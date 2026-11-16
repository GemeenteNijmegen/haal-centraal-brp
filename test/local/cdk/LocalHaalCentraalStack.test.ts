import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { localConfig } from './localConfig';
import { LocalHaalCentraalStack } from './LocalHaalCentraalStack';

function template() {
  // Skip esbuild bundling of the lambdas, it is not needed to check the template
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new LocalHaalCentraalStack(app, 'LocalHaalCentraalStack', {
    env: { account: localConfig.account, region: localConfig.region },
    clientCertificate: { key: 'key', cert: 'cert', ca: 'ca' },
  });
  return Template.fromStack(stack);
}

test('creates the three request lambdas with pinned names', () => {
  const t = template();
  for (const name of ['personen', 'subset', 'partnerfilter']) {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `local-${name}`,
      Runtime: 'nodejs24.x',
    });
  }
});

test('gives every request lambda the environment the handlers read', () => {
  const t = template();
  const functions = t.findResources('AWS::Lambda::Function');
  expect(Object.keys(functions)).toHaveLength(3);
  for (const fn of Object.values(functions)) {
    expect(Object.keys(fn.Properties.Environment.Variables)).toEqual(expect.arrayContaining([
      'BRP_API_KEY_ARN',
      'LAYER7_ENDPOINT',
      'CERTIFICATE',
      'CERTIFICATE_KEY',
      'CERTIFICATE_CA',
      'ID_TABLE_NAME',
      'DEV_MODE',
      'REQUEST_LOG_TABLE_NAME',
      'BSN_HASH_SALT_ARN',
      'REQUIRE_REQUEST_LOG_HEADERS',
    ]));
  }
});

test('requires an API key on every method', () => {
  const t = template();
  const methods = t.findResources('AWS::ApiGateway::Method');
  expect(Object.keys(methods).length).toBeGreaterThanOrEqual(6);
  for (const method of Object.values(methods)) {
    expect(method.Properties.ApiKeyRequired).toBe(true);
  }
});

test('creates an API key with a fixed value for every local application', () => {
  const t = template();
  for (const application of localConfig.applications) {
    t.hasResourceProperties('AWS::ApiGateway::ApiKey', { Value: application.apiKey });
  }
});

test('pins the REST API id', () => {
  template().hasResourceProperties('AWS::ApiGateway::RestApi', {
    Tags: Match.arrayWith([{ Key: 'ms-custom-id', Value: localConfig.apiId }]),
  });
});

test('creates the application and request log tables with pinned names', () => {
  const t = template();
  t.hasResourceProperties('AWS::DynamoDB::Table', { TableName: localConfig.tables.applications });
  t.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: localConfig.tables.requestLog,
    KeySchema: [
      { AttributeName: 'bsnHash', KeyType: 'HASH' },
      { AttributeName: 'requestedAt', KeyType: 'RANGE' },
    ],
  });
});
