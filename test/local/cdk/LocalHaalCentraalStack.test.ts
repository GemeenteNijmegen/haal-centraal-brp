import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { localConfig } from './localConfig';
import { LocalHaalCentraalStack } from './LocalHaalCentraalStack';
import { ApiStack } from '../../../src/ApiStack';
import { Configuration } from '../../../src/Configuration';
import { SUBSET_ENDPOINTS } from '../../../src/personen/subset/handlers/subset-endpoint-handler-config';

const productionLikeEnv = { account: '123456789012', region: 'eu-central-1' };
const configuration: Configuration = {
  branch: 'test',
  buildEnvironment: productionLikeEnv,
  deploymentEnvironment: productionLikeEnv,
  devMode: true,
};
// Tracing is not available in MiniStack
const notUsedLocally = ['TRACING_ENABLED'];

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

test('gives every request lambda the environment of the request lambdas in ApiStack', () => {
  const app = new App();
  const apiStack = new ApiStack(app, 'api', { env: productionLikeEnv, configuration });
  const requestFunctions = Object.values(Template.fromStack(apiStack).findResources('AWS::Lambda::Function'))
    .filter(fn => fn.Properties.Environment?.Variables?.ID_TABLE_NAME);
  expect(requestFunctions).toHaveLength(3);
  const expectedVariables = new Set(requestFunctions
    .flatMap(fn => Object.keys(fn.Properties.Environment.Variables))
    .filter(name => !notUsedLocally.includes(name) && !name.startsWith('AWS_XRAY_')));

  const functions = template().findResources('AWS::Lambda::Function');
  expect(Object.keys(functions)).toHaveLength(3);
  for (const fn of Object.values(functions)) {
    expect(Object.keys(fn.Properties.Environment.Variables)).toEqual(expect.arrayContaining([...expectedVariables]));
  }
});

test('requires an API key on every method', () => {
  const t = template();
  const methods = t.findResources('AWS::ApiGateway::Method');
  // /personen, /brp/personen, /partnerfilter/personen, /personen/burgerservicenummer and one per subset endpoint
  expect(Object.keys(methods)).toHaveLength(4 + SUBSET_ENDPOINTS.length);
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
