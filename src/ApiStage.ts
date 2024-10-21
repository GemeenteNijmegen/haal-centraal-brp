import { PermissionsBoundaryAspect } from '@gemeentenijmegen/aws-constructs';
import { Aspects, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ApiStack } from './ApiStack';
import { Configurable } from './Configuration';
import { ParameterStack } from './ParameterStack';

interface ApiStageProps extends Configurable, StageProps {}

export class ApiStage extends Stage {
  constructor(scope: Construct, id: string, props: ApiStageProps) {
    super(scope, id, props);
    Aspects.of(this).add(new PermissionsBoundaryAspect());

    new ParameterStack(this, 'param-stack', {
      env: props.configuration.deploymentEnvironment,
      description: 'Haal Centraal BRP parameters',
    });

    new ApiStack(this, 'api-stack', {});
  }
}