/**
 * All values for the local MiniStack setup in one place. Nothing in here is
 * a real secret or a real endpoint, see test/local/README.md.
 */
export const localConfig = {
  /**
   * MiniStack's default fake account id. Matches the `cdk bootstrap` call in
   * scripts/local.sh.
   */
  account: '000000000000',
  /**
   * Same region as production. docker-compose.yml sets MINISTACK_REGION to
   * the same value.
   */
  region: 'eu-central-1',
  /**
   * Pinned REST API id (MiniStack's `ms-custom-id` tag), so the invoke URL is
   * the same after every deploy.
   */
  apiId: 'haal-centraal',
  /**
   * The REST API's default stage, part of the invoke URL.
   */
  stageName: 'prod',
  /**
   * Prefix for the pinned Lambda function names, so their log groups are
   * predictable (`/aws/lambda/local-<name>`, see scripts/local.sh logs).
   */
  functionNamePrefix: 'local-',
  tables: {
    applications: 'local-app-id-storage',
    requestLog: 'local-request-log',
  },
  /**
   * Applications that may call the API. Each gets an API key with this fixed
   * value, and scripts/seed.ts writes its profile (name and allowed fields)
   * to the applications table.
   */
  applications: [
    {
      id: 'local-full',
      name: 'Lokaal volledig',
      apiKey: 'local-full-api-key-0123456789',
      fields: [
        'burgerservicenummer',
        'naam',
        'geslacht',
        'geboorte',
        'geboorte.datum',
        'leeftijd',
        'nationaliteiten',
        'partners',
        'kinderen',
        'ouders',
        'adressering',
        'verblijfplaats',
      ],
    },
    {
      id: 'local-limited',
      name: 'Lokaal beperkt',
      apiKey: 'local-limited-api-key-0123456789',
      fields: ['naam'],
    },
  ],
  /**
   * The BRP API (Layer7 in production): the personen-mock behind the
   * brp-mock-tls proxy in docker-compose.yml.
   */
  brpEndpoint: 'https://haalcentraal.brp-mock/haalcentraal/api/brp/personen',
  bsnHashSalt: 'local-bsn-hash-salt',
  /**
   * Value for secrets the mock doesn't check (the BRP API key).
   */
  unusedSecretValue: 'not-used-locally',
};
