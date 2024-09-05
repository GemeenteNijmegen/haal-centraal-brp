import { HostedZone, IHostedZone, ZoneDelegationRecord } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { Statics } from '../Statics';

interface DnsConstructProps {
  subdomain: string;
}


export class DnsConstruct extends Construct {

  readonly hostedzone: HostedZone;

  constructor(scope: Construct, id: string, props: DnsConstructProps) {
    super(scope, id);
    const accountRootZone = this.getAccountRootZone();
    this.hostedzone = this.createSubdomain(accountRootZone, props);
  }

  private getAccountRootZone() {
    const accountRootZoneId = StringParameter.valueForStringParameter(this, Statics.accountRootHostedZoneId);
    const accountRootZoneName = StringParameter.valueForStringParameter(this, Statics.accountRootHostedZoneName);
    const accountRootZone = HostedZone.fromHostedZoneAttributes(this, 'account-root-zone', {
      hostedZoneId: accountRootZoneId,
      zoneName: accountRootZoneName,
    });

    return accountRootZone;
  }

  private createSubdomain(accountRootZone: IHostedZone, props: DnsConstructProps) {

    const hostedzone = new HostedZone(this, 'hostedzone', {
      zoneName: `${props.subdomain}.${accountRootZone.zoneName}`,
      comment: `${Statics.projectName} hostedzone`,
    });

    // Add NS record to parent zone
    new ZoneDelegationRecord(this, 'delegation', {
      recordName: `${props.subdomain}.${accountRootZone.zoneName}`,
      nameServers: hostedzone.hostedZoneNameServers!,
      zone: accountRootZone,
    });

    return hostedzone;

  }
}