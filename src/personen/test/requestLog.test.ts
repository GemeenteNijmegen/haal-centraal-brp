import {
  buildRequestLogItems,
  collectTargets,
  hashBsn,
  RequestLogEntry,
  stripBsnField,
  withBsnField,
} from '../requestLog';

const SALT = 'test-salt';
// HMAC-SHA256('test-salt', '999971785'), also reproducible with: printf '999971785' | openssl dgst -sha256 -hmac 'test-salt'
const HASH_999971785 = '3c909c6a01bc997a512c67730b15e961bcb8c64c8c72b8cae41af9bd7c16ecfa';

describe('hashBsn', () => {
  it('returns the lowercase hex HMAC-SHA256 of the BSN', () => {
    expect(hashBsn('999971785', SALT)).toBe(HASH_999971785);
  });

  it('ignores surrounding whitespace', () => {
    expect(hashBsn(' 999971785 ', SALT)).toBe(HASH_999971785);
  });

  it('gives a different hash for a different salt', () => {
    expect(hashBsn('999971785', 'other-salt')).not.toBe(HASH_999971785);
  });
});

describe('collectTargets', () => {
  it('marks a requested BSN that is returned as gevonden', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }] };
    expect(collectTargets(['999971785'], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
    ]);
  });

  it('marks a requested BSN that is not returned as geen-resultaat', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }] };
    expect(collectTargets(['999971785', '999999333'], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
      { bsn: '999999333', resultaat: 'geen-resultaat' },
    ]);
  });

  it('adds returned persons from a search without requested BSNs', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: '999999333' }] };
    expect(collectTargets([], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
      { bsn: '999999333', resultaat: 'gevonden' },
    ]);
  });

  it('deduplicates BSNs', () => {
    const body = { personen: [{ burgerservicenummer: '999971785' }, { burgerservicenummer: '999971785' }] };
    expect(collectTargets(['999971785', ' 999971785'], 200, body)).toEqual([
      { bsn: '999971785', resultaat: 'gevonden' },
    ]);
  });

  it('marks every requested BSN as fout when Haal Centraal returns an error', () => {
    expect(collectTargets(['999971785', '999999333'], 400, { title: 'Bad request' })).toEqual([
      { bsn: '999971785', resultaat: 'fout' },
      { bsn: '999999333', resultaat: 'fout' },
    ]);
  });

  it('marks requested BSNs as geen-resultaat when the body has no personen', () => {
    expect(collectTargets(['999971785'], 200, {})).toEqual([
      { bsn: '999971785', resultaat: 'geen-resultaat' },
    ]);
    expect(collectTargets(['999971785'], 200, undefined)).toEqual([
      { bsn: '999971785', resultaat: 'geen-resultaat' },
    ]);
  });

  it('returns no targets for a search without BSN and without hits', () => {
    expect(collectTargets([], 200, { personen: [] })).toEqual([]);
  });

  it('ignores empty BSN values', () => {
    expect(collectTargets(['', '  '], 200, { personen: [{ naam: {} }] })).toEqual([]);
  });
});

describe('withBsnField', () => {
  it('adds burgerservicenummer when missing', () => {
    expect(withBsnField(['naam'])).toEqual(['naam', 'burgerservicenummer']);
  });

  it('leaves the fields alone when burgerservicenummer is present', () => {
    const fields = ['burgerservicenummer', 'naam'];
    expect(withBsnField(fields)).toBe(fields);
  });
});

describe('stripBsnField', () => {
  const data = {
    type: 'ZoekMetPostcodeEnHuisnummer',
    personen: [
      { burgerservicenummer: '999971785', naam: { voornamen: 'A' }, partners: [{ burgerservicenummer: '999999333' }] },
    ],
  };

  it('removes burgerservicenummer from each person when it was not requested', () => {
    expect(stripBsnField(data, ['naam', 'partners'])).toEqual({
      type: 'ZoekMetPostcodeEnHuisnummer',
      personen: [
        { naam: { voornamen: 'A' }, partners: [{ burgerservicenummer: '999999333' }] },
      ],
    });
  });

  it('keeps burgerservicenummer when it was requested', () => {
    expect(stripBsnField(data, ['burgerservicenummer', 'naam'])).toBe(data);
  });

  it('leaves a body without personen alone', () => {
    expect(stripBsnField({ title: 'error' }, ['naam'])).toEqual({ title: 'error' });
  });
});

describe('buildRequestLogItems', () => {
  const entry: RequestLogEntry = {
    requestId: 'req-1',
    requestTime: new Date('2026-11-16T10:00:00.123Z'),
    application: 'ApiKeyTest',
    apiKeyId: 'key-id',
    endpoint: '/personen',
    requestType: 'RaadpleegMetBurgerservicenummer',
    fields: ['naam'],
    statusCode: 200,
    headers: {
      gebruiker: 'medewerker-1',
      gebruikerHeader: 'x-gebruiker',
      doelbinding: 'BRPACT-Totaal',
      doelbindingHeader: 'x-doelbinding',
      fscTransactionId: 'fsc-1',
    },
  };

  it('builds one item per target with the hashed BSN as key', () => {
    const items = buildRequestLogItems(entry, [
      { bsn: '999971785', resultaat: 'gevonden' },
      { bsn: '999999333', resultaat: 'geen-resultaat' },
    ], SALT);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      bsnHash: { S: HASH_999971785 },
      requestedAt: { S: '2026-11-16T10:00:00.123Z#req-1' },
      requestId: { S: 'req-1' },
      application: { S: 'ApiKeyTest' },
      apiKeyId: { S: 'key-id' },
      endpoint: { S: '/personen' },
      requestType: { S: 'RaadpleegMetBurgerservicenummer' },
      fields: { L: [{ S: 'naam' }] },
      statusCode: { N: '200' },
      resultaat: { S: 'gevonden' },
      gebruiker: { S: 'medewerker-1' },
      gebruikerHeader: { S: 'x-gebruiker' },
      doelbinding: { S: 'BRPACT-Totaal' },
      doelbindingHeader: { S: 'x-doelbinding' },
      fscTransactionId: { S: 'fsc-1' },
    });
    expect(items[1].resultaat).toEqual({ S: 'geen-resultaat' });
  });

  it('never stores the plain BSN', () => {
    const items = buildRequestLogItems(entry, [{ bsn: '999971785', resultaat: 'gevonden' }], SALT);
    expect(JSON.stringify(items)).not.toContain('999971785');
  });
});
