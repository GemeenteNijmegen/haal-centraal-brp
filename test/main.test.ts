import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
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