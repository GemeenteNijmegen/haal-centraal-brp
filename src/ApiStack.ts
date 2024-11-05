import { Duration, RemovalPolicy, Stack, StackProps, aws_dynamodb, aws_s3, aws_s3_deployment, aws_secretsmanager } from 'aws-cdk-lib';
import { ApiKey, LambdaIntegration, RestApi, SecurityPolicy } from 'aws-cdk-lib/aws-apigateway';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGateway } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Configurable } from './Configuration';
import { DnsConstruct } from './constructs/DnsConstruct';
import { PersonenFunction } from './personen/personen-function';
import { Statics } from './Statics';

interface ApiStackProps extends Configurable, StackProps {

}

export class ApiStack extends Stack {
  readonly subdomain: DnsConstruct;


  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    this.subdomain = new DnsConstruct(this, 'subdomain', {
      subdomain: 'api',
    });

    const idTable = this.appIdStorage();
    const cert = this.cert();
    const api = this.api(cert);
    this.addDnsRecords(api);

    const resource = api.root.addResource('personen');
    const personenFunction = this.personenFunction(idTable, props.configuration.devMode);

    const lambdaIntegration = new LambdaIntegration(personenFunction);
    resource.addMethod('POST', lambdaIntegration, {
      apiKeyRequired: true,
    });

  }

  private addDnsRecords(api: RestApi) {
    new ARecord(this, 'a-record', {
      zone: this.subdomain.hostedzone,
      target: RecordTarget.fromAlias(new ApiGateway(api)),
    });
  }

  private personenFunction(idTable: Table, devMode: boolean) {
    const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);
    const layer7Endpoint = StringParameter.fromStringParameterName(this, 'brp-haal-centraal-layer7-eindpoint-param', Statics.layer7EndpointName);
    const certificate = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-secret', Statics.certificate);
    const certificateKey = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-key-secret', Statics.certificateKey);
    const certificateCa = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-ca-secret', Statics.certificateCa);

    const personenLambda = new PersonenFunction(this, 'personenfunction', {
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        BRP_API_KEY_ARN: brpHaalCentraalApiKeySecret.secretArn,
        LAYER7_ENDPOINT: Statics.layer7EndpointName,
        CERTIFICATE: certificate.secretArn,
        CERTIFICATE_KEY: certificateKey.secretArn,
        CERTIFICATE_CA: certificateCa.secretArn,
        ID_TABLE_NAME: idTable.tableName,
        DEV_MODE: devMode ? 'true' : 'false',
      },
    });
    brpHaalCentraalApiKeySecret.grantRead(personenLambda);
    certificate.grantRead(personenLambda);
    certificateKey.grantRead(personenLambda);
    certificateCa.grantRead(personenLambda);
    layer7Endpoint.grantRead(personenLambda);
    idTable.grantReadWriteData(personenLambda);
    return personenLambda;
  }

  private api(cert: Certificate) {
    const truststore = new aws_s3.Bucket(this, 'truststore-certs-bucket-api', {
      //versioned: true, TODO enable?
    });

    const deployment = new aws_s3_deployment.BucketDeployment(this, 'bucket-deployment-truststore-certs-api', {
      sources: [aws_s3_deployment.Source.asset('./src/certs/')],
      destinationBucket: truststore,
    });

    const api = new RestApi(this, 'api', {
      description: 'API Gateway for Haal Centraal BRP',
      domainName: {
        certificate: cert,
        domainName: this.subdomain.hostedzone.zoneName,
        securityPolicy: SecurityPolicy.TLS_1_2,
        mtls: {
          bucket: truststore,
          key: 'truststore.pem',
        },
      },
      disableExecuteApiEndpoint: true,
    });

    // Wait for deployment to be finished before creating/updating api.
    api.node.addDependency(deployment);

    const plan = api.addUsagePlan('plan', {
      description: 'internal use',
    });
    const key = new ApiKey(this, 'apikey', {
      description: 'Haal Centraal BRP Api Key',
    });
    plan.addApiKey(key);
    plan.node.addDependency(key);
    plan.addApiStage({
      stage: api.deploymentStage,
    });
    return api;
  }

  private cert() {
    const cert = new Certificate(this, 'api-cert', {
      domainName: this.subdomain.hostedzone.zoneName,
      validation: CertificateValidation.fromDns(this.subdomain.hostedzone),
    });
    return cert;
  }

  /**
   * Stores information about different applications that make use of this API.
   * This includes information like the allowd Haal Centraal BRP Fields.
   * @returns Application ID Table
   */
  private appIdStorage() {
    const appIdStorage = new aws_dynamodb.Table(this, 'app-id-storage', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    return appIdStorage;
  }
}
