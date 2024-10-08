import { Stack, StackProps, aws_iam, aws_s3, aws_s3_deployment } from 'aws-cdk-lib';
import { ApiKey, HttpIntegration, MethodLoggingLevel, RestApi, SecurityPolicy, TokenAuthorizer } from 'aws-cdk-lib/aws-apigateway';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGateway } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
//import { AuthorizerFunction } from './authorizer/authorizer-function';
import { AuthorizerFunction } from './authorizer/authorizer-function';
import { DnsConstruct } from './constructs/DnsConstruct';
// import { PersonenFunction } from './personen/personen-function';
// import { Statics } from './Statics';

export class ApiStack extends Stack {
  readonly subdomain: DnsConstruct;


  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.subdomain = new DnsConstruct(this, 'subdomain', {
      subdomain: 'api',
    });

    const cert = this.cert();
    const api = this.api(cert);
    this.addDnsRecords(api);

    const resource = api.root.addResource('personen');
    //const personenFunction = this.personenFunction();
    const authToken = this.authorizeToken(api);

    //const lambdaIntegration = new LambdaIntegration(personenFunction);
    // resource.addMethod('GET', lambdaIntegration, {
    //   apiKeyRequired: true,
    //   //authorizer: authToken,
    // });
    // resource.addMethod('POST', lambdaIntegration, {
    //   apiKeyRequired: true,
    //   //authorizer: authToken,
    // });

    const httpIntegration = new HttpIntegration('https://webhook.site/a80e0e0c-9951-413a-8897-f7cd178e1710');
    resource.addMethod('POST', httpIntegration, {
      apiKeyRequired: true,
      authorizer: authToken,
    });

  }

  private addDnsRecords(api: RestApi) {
    new ARecord(this, 'a-record', {
      zone: this.subdomain.hostedzone,
      target: RecordTarget.fromAlias(new ApiGateway(api)),
    });
  }

  // private personenFunction() {
  //   const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);

  //   const personenLambda = new PersonenFunction(this, 'personenfunction', {
  //     timeout: Duration.seconds(30),
  //     environment: {
  //       BRP_API_KEY_ARN: brpHaalCentraalApiKeySecret.secretArn,
  //     },
  //   });
  //   brpHaalCentraalApiKeySecret.grantRead(personenLambda);
  //   return personenLambda;
  // }

  private authorizeToken(api: RestApi) {
    const authorizerLambda = new AuthorizerFunction(this, 'authorizerfunction', {});

    authorizerLambda.addPermission('ApiGatewayInvokeLambda', {
      principal: new aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: api.arnForExecuteApi(),
      action: 'lambda:InvokeFunction',
    });

    const authToken = new TokenAuthorizer(this, 'requestauthorizer', {
      handler: authorizerLambda,
      // identitySource: 'method.request.header.AuthorizeToken',
    });

    return authToken;
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
}
