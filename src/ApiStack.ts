import { Duration, Stack, StackProps, aws_s3, aws_s3_deployment, aws_secretsmanager } from 'aws-cdk-lib';
import { ApiKey, HttpIntegration, LambdaIntegration, MethodLoggingLevel, RestApi, SecurityPolicy } from 'aws-cdk-lib/aws-apigateway';
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
    const api = this.api(cert);
    this.addDnsRecords(api);

    const apiGatewayOut = this.apiGatewayOut();

    const resource = api.root.addResource('personen');
    const personenFunction = this.personenFunction(apiGatewayOut.url);

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

  private personenFunction(apiGatewayOutUrl: string) {
    //const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);
    const internalBrpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'internal-brp-haal-centraal-api-key-auth-secret', Statics.internalBrpHaalCentraalApiKeySecret);

    const personenLambda = new PersonenFunction(this, 'personenfunction', {
      timeout: Duration.seconds(30),
      environment: {
        INTERNAL_API_KEY_ARN: internalBrpHaalCentraalApiKeySecret.secretArn,
        API_GATEWAY_OUT_URL: apiGatewayOutUrl,
      },
    });
    //brpHaalCentraalApiKeySecret.grantRead(personenLambda);
    internalBrpHaalCentraalApiKeySecret.grantRead(personenLambda);
    return personenLambda;
  }

  // private authorizeToken(api: RestApi) {
  //   const authorizerLambda = new AuthorizerFunction(this, 'authorizerfunction');

  //   authorizerLambda.addPermission('ApiGatewayInvokeLambda', {
  //     principal: new aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
  //     sourceArn: api.arnForExecuteApi(),
  //     action: 'lambda:InvokeFunction',
  //   });

  //   const authToken = new TokenAuthorizer(this, 'requestauthorizer', {
  //     handler: authorizerLambda,
  //     identitySource: IdentitySource.header('Authorization'),
  //   });

  //   return authToken;
  // }

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

  private apiGatewayOut() {
    const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);

    const api = new RestApi(this, 'api-gateway-out', {
      description: 'Haal Centraal BRP API Gateway Outwards to Layer7 (iRvN)',
      deployOptions: { loggingLevel: MethodLoggingLevel.INFO },
    });

    const httpIntegration = new HttpIntegration('https://proefomgeving.haalcentraal.nl/haalcentraal/api/brp', {
      proxy: true,
      options: {
        requestParameters: {
          'X-API-KEY': brpHaalCentraalApiKeySecret.secretValue.toString(), //TODO is this secure?
        },
      },
    });

    api.root.addProxy({
      defaultIntegration: httpIntegration,
      anyMethod: true, //TODO better security, api key?
    });

    const plan = api.addUsagePlan('internal-plan', {
      description: 'internal use',
    });
    const key = new ApiKey(this, 'internal-apikey', {
      description: 'Haal Centraal BRP Api Key for Outwards API Gateway',
    });
    plan.addApiKey(key);
    plan.node.addDependency(key);
    plan.addApiStage({
      stage: api.deploymentStage,
    });

    return api;
  };

  private cert() {
    const cert = new Certificate(this, 'api-cert', {
      domainName: this.subdomain.hostedzone.zoneName,
      validation: CertificateValidation.fromDns(this.subdomain.hostedzone),
    });
    return cert;
  }
}
