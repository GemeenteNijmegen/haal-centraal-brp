import { App } from 'aws-cdk-lib';
import { getEnvironmentConfiguration } from './Configuration';
import { PipelineStack } from './PipelineStack';
import { Statics } from './Statics';

const branchToBuild = process.env.BRANCH_NAME ?? 'development';
const configuration = getEnvironmentConfiguration(branchToBuild);


const app = new App();

new PipelineStack(app, `${Statics.projectName}-pipeline-${branchToBuild}`, {
  configuration: configuration,
  env: configuration.buildEnvironment,
});

app.synth();