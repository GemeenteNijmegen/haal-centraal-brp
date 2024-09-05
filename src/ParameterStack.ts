import { Stack, StackProps } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class ParameterStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new StringParameter(this, 'dummy', {
      stringValue: '-',
      parameterName: '/haalcentraalbrp/dummy',
    });

  }
}