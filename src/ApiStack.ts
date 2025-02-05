import { Duration, RemovalPolicy, Stack, StackProps, aws_dynamodb, aws_s3, aws_s3_deployment, aws_secretsmanager, aws_lambda_event_sources, aws_iam } from 'aws-cdk-lib';
import { ApiKey, LambdaIntegration, RestApi, SecurityPolicy } from 'aws-cdk-lib/aws-apigateway';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGateway } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CertificatesFunction } from './certs/certificates-function';
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
    const truststore = this.trustStore();
    const api = this.api(cert, truststore.bucket, truststore.deployment);
    this.addDnsRecords(api);

    const resource = api.root.addResource('personen');
    const personenFunction = this.personenFunction(idTable, props.configuration.devMode);

    const lambdaIntegration = new LambdaIntegration(personenFunction);
    resource.addMethod('POST', lambdaIntegration, {
      apiKeyRequired: true,
    });

    const certificateStorage = this.certificateStorage();
    const certificateFunction = this.certificateFunction(api, certificateStorage.bucketName);

    const lambdaEventSource = new aws_lambda_event_sources.S3EventSourceV2(certificateStorage, {
      events: [
        aws_s3.EventType.OBJECT_CREATED,
        aws_s3.EventType.OBJECT_REMOVED,
      ],
    });
    certificateFunction.addEventSource(lambdaEventSource);
    certificateStorage.grantRead(certificateFunction); // Granting certificate function read access to the certificate storage bucket.
    truststore.bucket.grantReadWrite(certificateFunction); // Granting certificate function write access to the truststore bucket.

    // Grant the Lambda function permission to access the API Gateway
    const apiGatewayPolicy = new aws_iam.PolicyStatement({
      actions: ['apigateway:GET'],
      resources: [api.arnForExecuteApi()],
    });
    certificateFunction.addToRolePolicy(apiGatewayPolicy);

  }

  private addDnsRecords(api: RestApi) {
    new ARecord(this, 'a-record', {
      zone: this.subdomain.hostedzone,
      target: RecordTarget.fromAlias(new ApiGateway(api)),
    });
  }

  /**
   * Function that validates the incoming profile and forwards the request.
   * @param idTable Table containing the relevant application-ids (api keys) related to a specific set of fields.
   * @param devMode Wether or not devmode is enabled.
   * @returns The personen lambda
   */
  private personenFunction(idTable: Table, devMode: boolean) {
    // All relevant secrets and layer7 endpoint
    const brpHaalCentraalApiKeySecret = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-api-key-auth-secret', Statics.haalCentraalApiKeySecret);
    const layer7Endpoint = StringParameter.fromStringParameterName(this, 'brp-haal-centraal-layer7-eindpoint-param', Statics.layer7EndpointName);
    const certificate = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-secret', Statics.certificate);
    const certificateKey = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-key-secret', Statics.certificateKey);
    const certificateCa = aws_secretsmanager.Secret.fromSecretNameV2(this, 'brp-haal-centraal-certificate-ca-secret', Statics.certificateCa);

    // Function that validates the profile and forwards the request.
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

  /**
   * Creates a bucket to store the truststore certificates (.pem file).
   * @returns Truststore bucket and deployment
   */
  private trustStore() {
    // Truststore bucket that contains a .pem file.
    const bucket = new aws_s3.Bucket(this, 'truststore-certs-bucket-api', {
      versioned: true,
    });

    // The .pem contains all certificates (including the relevant trust chain) that are allowed to make a request to the gateway.
    const deployment = new aws_s3_deployment.BucketDeployment(this, 'bucket-deployment-truststore-certs-api', {
      sources: [aws_s3_deployment.Source.asset('./src/certs/deploy')],
      destinationBucket: bucket,
    });

    return { bucket, deployment };
  }

  /**
   * API Gateway for Haal Centraal BRP.
   * @param cert Certificate linked to custom domain
   * @returns The gateway api.
   */
  private api(cert: Certificate, truststore: aws_s3.Bucket, deployment: aws_s3_deployment.BucketDeployment) {
    // Rest API with custom domain.
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

    // Usage plan attached to the api gateway.
    const plan = api.addUsagePlan('plan', {
      description: 'internal use',
    });

    // Api key attached to the usage plan
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

  /**
   * Creates a bucket to store the certificates.
   * @returns Certificate storage bucket
   */
  private certificateStorage() {
    const certificateStorage = new aws_s3.Bucket(this, 'certificate-storage', {
      removalPolicy: RemovalPolicy.RETAIN,
    });

    return certificateStorage;
  }

  /**
   * On object change (created or removed) in certificate storage the lambda
   * updates the truststore in the api s3 bucket.
   * @param api rest api
   * @param bucketName bucket name
   * @returns Function that updates the truststore in the api s3 bucket
   */
  private certificateFunction(api: RestApi, bucketName: string) {
    const certificateFunction = new CertificatesFunction(this, 'certificate-function', {
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        CERT_BUCKET_NAME: bucketName,
        CUSTOM_DOMAIN_NAME: api.domainName?.domainName ?? '',
      },
    });

    return certificateFunction;
  }
}
