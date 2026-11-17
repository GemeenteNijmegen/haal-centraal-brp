import { localConfig } from '../cdk/localConfig';

/**
 * Runs against the local stack, see test/local/README.md. Start it with
 * `test/local/scripts/local.sh start`, then run `test/local/scripts/local.sh test`.
 */
const apiUrl = `http://localhost:4566/_aws/execute-api/${localConfig.apiId}/${localConfig.stageName}`;
const fullAccess = localConfig.applications.find(application => application.id === 'local-full')!;

// The first request also starts a Lambda container
jest.setTimeout(60000);

describe('POST /personen', () => {
  it('returns the requested fields of the person', async () => {
    const response = await fetch(`${apiUrl}/personen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': fullAccess.apiKey,
        'x-gebruiker': 'local-test',
        'x-doelbinding': 'local-test',
      },
      body: JSON.stringify({
        type: 'RaadpleegMetBurgerservicenummer',
        burgerservicenummer: ['999999333'],
        fields: ['naam'],
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.personen).toHaveLength(1);
    expect(body.personen[0].naam).toMatchObject({
      voornamen: 'Nasier',
      geslachtsnaam: 'Boeddhoe',
    });
    // Only the requested fields: burgerservicenummer is added for the request log and removed again
    expect(Object.keys(body.personen[0])).toEqual(['naam']);
  });
});
