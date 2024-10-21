import { Stack, StackProps, aws_secretsmanager as SecretsManager } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from './Statics';

export class ParameterStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new StringParameter(this, 'dummy', {
      stringValue: '-',
      parameterName: '/haalcentraalbrp/dummy',
    });

    new StringParameter(this, 'layer7-endpoint', {
      stringValue: '-',
      parameterName: Statics.layer7EndpointName,
    });

    new SecretsManager.Secret(this, 'haalcentraal_secret_1', {
      secretName: Statics.haalCentraalApiKeySecret,
      description: 'BRP Api key haal centraal',
    });

    new SecretsManager.Secret(this, 'haalcentraal_secret_2', {
      secretName: Statics.internalBrpHaalCentraalApiKeySecret,
      description: 'BRP Api key haal centraal for the Outwards Gateway (internal)',
    });

    new SecretsManager.Secret(this, 'haalcentraal_secret_3', {
      secretName: Statics.certificateKey,
      description: 'Certificate key haal centraal',
    });

    new SecretsManager.Secret(this, 'haalcentraal_secret_4', {
      secretName: Statics.certificate,
      description: 'Certificate haal centraal',
    });

  }
}