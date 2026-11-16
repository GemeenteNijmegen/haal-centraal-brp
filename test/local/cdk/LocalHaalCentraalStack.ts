import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, StackProps, Tags } from 'aws-cdk-lib';
import { ApiKey, LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, RuntimeFamily } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { localConfig } from './localConfig';
import { SUBSET_ENDPOINTS } from '../../../src/personen/subset/handlers/subset-endpoint-handler-config';
import { Statics } from '../../../src/Statics';

const repoRoot = path.join(__dirname, '../../..');

export interface LocalHaalCentraalStackProps extends StackProps {
  /**
   * Client certificate the lambdas use to call the BRP API. Must be valid
   * PEM, or the https agent fails before the request is sent.
   */
  clientCertificate: { key: string; cert: string; ca: string };
}

/**
 * The request part of ApiStack, meant to be `cdk deploy`'d against MiniStack
 * (github.com/ministackorg/ministack), a local AWS emulator, not against real
 * AWS. See test/local/README.md for what is left out and why.
 */
export class LocalHaalCentraalStack extends Stack {
  private readonly applicationsTable: Table;
  private readonly requestLogTable: Table;
  private readonly functionEnvironment: Record<string, string>;
  private readonly secrets: Secret[];
  private readonly brpEndpoint: StringParameter;

  constructor(scope: Construct, id: string, props: LocalHaalCentraalStackProps) {
    super(scope, id, props);

    // Same keys as in ApiStack, but pinned names and not retained, so a
    // redeploy starts clean.
    this.applicationsTable = new Table(this, 'app-id-storage', {
      tableName: localConfig.tables.applications,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.requestLogTable = new Table(this, 'request-log', {
      tableName: localConfig.tables.requestLog,
      partitionKey: { name: 'bsnHash', type: AttributeType.STRING },
      sortKey: { name: 'requestedAt', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Secrets and parameters the lambdas read at runtime, under the same
    // names as in production.
    const brpApiKey = this.secret('brp-haal-centraal-api-key', Statics.haalCentraalApiKeySecret, localConfig.unusedSecretValue);
    const certificate = this.secret('certificate', Statics.certificate, props.clientCertificate.cert);
    const certificateKey = this.secret('certificate-key', Statics.certificateKey, props.clientCertificate.key);
    const certificateCa = this.secret('certificate-ca', Statics.certificateCa, props.clientCertificate.ca);
    const bsnHashSalt = this.secret('bsn-hash-salt', Statics.bsnHashSalt, localConfig.bsnHashSalt);
    this.secrets = [brpApiKey, certificate, certificateKey, certificateCa, bsnHashSalt];
    this.brpEndpoint = new StringParameter(this, 'layer7-endpoint', {
      parameterName: Statics.layer7EndpointName,
      stringValue: localConfig.brpEndpoint,
    });

    this.functionEnvironment = {
      BRP_API_KEY_ARN: brpApiKey.secretArn,
      LAYER7_ENDPOINT: Statics.layer7EndpointName,
      CERTIFICATE: certificate.secretArn,
      CERTIFICATE_KEY: certificateKey.secretArn,
      CERTIFICATE_CA: certificateCa.secretArn,
      ID_TABLE_NAME: this.applicationsTable.tableName,
      // Accept the self-signed certificate of the BRP mock
      DEV_MODE: 'true',
      DEBUG: 'true',
      REQUEST_LOG_TABLE_NAME: this.requestLogTable.tableName,
      BSN_HASH_SALT_ARN: bsnHashSalt.secretArn,
      REQUIRE_REQUEST_LOG_HEADERS: 'false',
      NODE_OPTIONS: '--enable-source-maps',
    };

    const api = new RestApi(this, 'api', {
      restApiName: 'local-haal-centraal-brp',
      description: '[LOCAL] API Gateway for Haal Centraal BRP',
    });
    Tags.of(api).add('ms-custom-id', localConfig.apiId);

    const usagePlan = api.addUsagePlan('plan', { description: 'local use' });
    usagePlan.addApiStage({ stage: api.deploymentStage });
    for (const application of localConfig.applications) {
      const key = new ApiKey(this, `apikey-${application.id}`, {
        apiKeyName: application.id,
        value: application.apiKey,
      });
      usagePlan.addApiKey(key);
    }

    const personenFunction = this.requestFunction('personen');
    const subsetFunction = this.requestFunction('subset');
    const partnerFilterFunction = this.requestFunction('partnerfilter');

    // Same resources as ApiStack
    const personen = api.root.addResource('personen');
    personen.addMethod('POST', new LambdaIntegration(personenFunction), { apiKeyRequired: true });
    api.root.addResource('brp').addResource('personen')
      .addMethod('POST', new LambdaIntegration(personenFunction), { apiKeyRequired: true });
    api.root.addResource('partnerfilter').addResource('personen')
      .addMethod('POST', new LambdaIntegration(partnerFilterFunction), { apiKeyRequired: true });
    const bsn = personen.addResource('burgerservicenummer');
    bsn.addMethod('GET', new LambdaIntegration(subsetFunction), { apiKeyRequired: true });
    for (const endpoint of SUBSET_ENDPOINTS) {
      bsn.addResource(endpoint.path)
        .addMethod('GET', new LambdaIntegration(subsetFunction), { apiKeyRequired: true });
    }

    new CfnOutput(this, 'ApiUrl', {
      value: `http://localhost:4566/_aws/execute-api/${localConfig.apiId}/${localConfig.stageName}/`,
    });
  }

  /**
   * Create a request lambda from its entry in test/local/lambda, which wraps
   * the real handler (see withApiKeyIdentity). Used instead of the
   * projen-generated function classes, which point at the bundle of the
   * unwrapped handler.
   * @param name Entry file name, also used in the function name
   * @returns The request lambda
   */
  private requestFunction(name: string) {
    const fn = new NodejsFunction(this, `${name}-function`, {
      // Pinned so the log group name is predictable, see scripts/local.sh logs
      functionName: `${localConfig.functionNamePrefix}${name}`,
      description: `[LOCAL] Haal Centraal ${name} endpoint function`,
      entry: path.join(__dirname, '../lambda', `${name}.ts`),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: new Runtime('nodejs24.x', RuntimeFamily.NODEJS),
      // Generous, as the first invocation also starts a Lambda container
      timeout: Duration.seconds(30),
      memorySize: 1024,
      environment: this.functionEnvironment,
      bundling: {
        target: 'node24',
        externalModules: ['@aws-sdk/*'],
        tsconfig: path.join(repoRoot, 'tsconfig.dev.json'),
        sourceMap: true,
      },
    });

    for (const secret of this.secrets) {
      secret.grantRead(fn);
    }
    this.brpEndpoint.grantRead(fn);
    this.applicationsTable.grantReadData(fn);
    this.requestLogTable.grant(fn, 'dynamodb:BatchWriteItem');
    fn.addToRolePolicy(new PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));
    return fn;
  }

  private secret(id: string, secretName: string, value: string) {
    return new Secret(this, id, {
      secretName,
      secretStringValue: SecretValue.unsafePlainText(value),
    });
  }
}
