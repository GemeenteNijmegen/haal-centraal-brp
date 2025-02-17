const { GemeenteNijmegenCdkApp } = require('@gemeentenijmegen/projen-project-type');
const project = new GemeenteNijmegenCdkApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  devDeps: ['@gemeentenijmegen/projen-project-type'],
  name: 'haal-centraal-brp',

  deps: ['@gemeentenijmegen/aws-constructs',
    '@gemeentenijmegen/utils',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-apigatewayv2',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/client-dynamodb',
    'https',
    'node-fetch',
    'dotenv'], /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // packageName: undefined,  /* The "name" in package.json. */
  depsUpgradeOptions: {
    workflowOptions: {
      branches: ['development'],
    },
  },
  jestOptions: {
    jestConfig: {
      setupFiles: ['dotenv/config'],
    },
  },
});
project.synth();