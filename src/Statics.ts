export class Statics {

  static readonly projectName = 'haal-centraal-brp';

  static readonly gnBuildEnvironment = {
    account: '836443378780',
    region: 'eu-central-1',
  };

  static readonly gnHaalCentraalBrpDevEnvironment = {
    account: '084828568398',
    region: 'eu-central-1',
  };

  static readonly gnHaalCentraalBrpAccpEnvironment = {
    account: '448049813413',
    region: 'eu-central-1',
  };

  static readonly accountRootHostedZonePath: string = '/gemeente-nijmegen/account/hostedzone/';
  static readonly accountRootHostedZoneId: string = '/gemeente-nijmegen/account/hostedzone/id';
  static readonly accountRootHostedZoneName: string = '/gemeente-nijmegen/account/hostedzone/name';

  /**
   * BRP Haal Centraal API Key
   */
  static readonly haalCentraalApiKeySecret: string = '/cdk/haal-centraal-brp/brp-haal-centraal-api-key';
}
