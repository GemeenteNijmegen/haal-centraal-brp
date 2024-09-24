import { aws_secretsmanager, Duration, Stack, StackProps, aws_s3, aws_s3_deployment } from 'aws-cdk-lib';
import { ApiKey, LambdaIntegration, RestApi, SecurityPolicy } from 'aws-cdk-lib/aws-apigateway';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGateway } from 'aws-cdk-lib/aws-route53-targets';
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

    const cert = this.cert();
    this.mtls();
    const api = this.api(cert);
    this.addDnsRecords(api);

    const resource = api.root.addResource('personen');
    const personenFunction = this.personenFunction();
    const lambdaIntegration = new LambdaIntegration(personenFunction);
    resource.addMethod('GET', lambdaIntegration, {
      apiKeyRequired: true,
    });
    resource.addMethod('POST', lambdaIntegration, { apiKeyRequired: true });
  }

  private addDnsRecords(api: RestApi) {
    new ARecord(this, 'a-record', {
      zone: this.subdomain.hostedzone,
      target: RecordTarget.fromAlias(new ApiGateway(api)),
    });
  }

  private personenFunction() {
    const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);

    const personenLambda = new PersonenFunction(this, 'personenfunction', {
      timeout: Duration.seconds(30),
      environment: {
        BRP_API_KEY_ARN: brpHaalCentraalApiKeySecret.secretArn,
      },
    });
    brpHaalCentraalApiKeySecret.grantRead(personenLambda);
    return personenLambda;
  }

  private api(cert: Certificate) {
    const api = new RestApi(this, 'api', {
      description: 'API Gateway for Haal Centraal BRP',
      domainName: {
        certificate: cert,
        domainName: this.subdomain.hostedzone.zoneName,
        securityPolicy: SecurityPolicy.TLS_1_2,
      },
    });

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

  private mtls() {
    const truststore = new aws_s3.Bucket(this, 'truststore');

    new aws_s3_deployment.BucketDeployment(this, 'trustore-bucket-deployment', {
      sources: [aws_s3_deployment.Source.asset('./src/truststore/')],
      destinationBucket: truststore,
    });

    const mtls = {
      bucket: truststore,
      key: 'truststore.pem',
    };
    return mtls;
  }
}
