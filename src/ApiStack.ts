import { Duration, RemovalPolicy, Stack, StackProps, aws_dynamodb, aws_s3, aws_s3_deployment, aws_secretsmanager } from 'aws-cdk-lib';
import { ApiKey, LambdaIntegration, MethodLoggingLevel, RestApi, SecurityPolicy } from 'aws-cdk-lib/aws-apigateway';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGateway } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { DnsConstruct } from './constructs/DnsConstruct';
import { PersonenFunction } from './personen/personen-function';
import { Statics } from './Statics';

export class ApiStack extends Stack {
  readonly subdomain: DnsConstruct;


  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.subdomain = new DnsConstruct(this, 'subdomain', {
      subdomain: 'api',
    });

    const idTable = this.appIdStorage();
    const cert = this.cert();
    const api = this.api(cert);
    this.addDnsRecords(api);

    const resource = api.root.addResource('personen');
    const personenFunction = this.personenFunction(idTable);

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

  private personenFunction(idTable: Table) {
    const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);
    const layer7Endpoint = StringParameter.valueForStringParameter(this, Statics.layer7EndpointName);
    const certificate = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-secret', Statics.certificate);
    const certificateKey = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-key-secret', Statics.certificateKey);
    const certificateCa = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-ca-secret', Statics.certificateCa);

    const personenLambda = new PersonenFunction(this, 'personenfunction', {
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        BRP_API_KEY_ARN: brpHaalCentraalApiKeySecret.secretArn,
        LAYER7_ENDPOINT: layer7Endpoint,
        CERTIFICATE: certificate.secretArn,
        CERTIFICATE_KEY: certificateKey.secretArn,
        CERTIFICATE_CA: certificateCa.secretArn,
        ID_TABLE_NAME: idTable.tableName,
      },
    });
    brpHaalCentraalApiKeySecret.grantRead(personenLambda);
    certificate.grantRead(personenLambda);
    certificateKey.grantRead(personenLambda);
    certificateCa.grantRead(personenLambda);
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
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
      },
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

  private appIdStorage() {
    const appIdStorage = new aws_dynamodb.Table(this, 'app-id-storage', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    return appIdStorage;
  }
}
