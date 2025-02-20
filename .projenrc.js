const { GemeenteNijmegenCdkApp } = require('@gemeentenijmegen/projen-project-type');
const project = new GemeenteNijmegenCdkApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'haal-centraal-brp',
  deps: [
    '@gemeentenijmegen/aws-constructs',
    '@gemeentenijmegen/utils',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-apigatewayv2',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/client-dynamodb',
    'https',
    'node-fetch',
    'dotenv',
  ],
  devDeps: [
    'aws-sdk-client-mock',
    'jest-aws-client-mock',
    '@gemeentenijmegen/projen-project-type',
  ],
  depsUpgradeOptions: {
    workflowOptions: {
      branches: ['development'],
      labels: ['auto-merge'],
    },
  },
  jestOptions: {
    jestConfig: {
      setupFiles: ['dotenv/config'],
    },
  },
});
project.synth();