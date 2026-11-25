import { withApiKeyIdentity } from './withApiKeyIdentity';

const apiKeys = [
  { id: 'local-full', value: 'full-key-value' },
  { id: 'local-limited', value: 'limited-key-value' },
];

function event(headers: Record<string, string> | null, identity: Record<string, string> = { sourceIp: '127.0.0.1' }) {
  return {
    resource: '/personen',
    headers,
    requestContext: { requestId: 'request-1', identity },
  };
}

describe('withApiKeyIdentity', () => {
  it('sets apiKey and apiKeyId from the X-API-KEY header', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 200 });

    await withApiKeyIdentity(handler, apiKeys)(event({ 'X-API-KEY': 'limited-key-value' }));

    expect(handler.mock.calls[0][0].requestContext.identity).toEqual({
      sourceIp: '127.0.0.1',
      apiKey: 'limited-key-value',
      apiKeyId: 'local-limited',
    });
  });

  it('matches the header name case-insensitively', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 200 });

    await withApiKeyIdentity(handler, apiKeys)(event({ 'x-api-key': 'full-key-value' }));

    expect(handler.mock.calls[0][0].requestContext.identity.apiKeyId).toBe('local-full');
  });

  it('keeps the rest of the event', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 200 });

    await withApiKeyIdentity(handler, apiKeys)(event({ 'X-API-KEY': 'full-key-value' }));

    expect(handler.mock.calls[0][0].resource).toBe('/personen');
    expect(handler.mock.calls[0][0].requestContext.requestId).toBe('request-1');
  });

  it('leaves apiKey and apiKeyId undefined without the header', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 200 });

    await withApiKeyIdentity(handler, apiKeys)(event(null));

    expect(handler.mock.calls[0][0].requestContext.identity).toEqual({ sourceIp: '127.0.0.1' });
  });

  it('leaves apiKeyId undefined for an unknown key', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 200 });

    await withApiKeyIdentity(handler, apiKeys)(event({ 'X-API-KEY': 'unknown' }));

    expect(handler.mock.calls[0][0].requestContext.identity).toEqual({ sourceIp: '127.0.0.1', apiKey: 'unknown' });
  });

  it('returns the result of the handler', async () => {
    const handler = jest.fn().mockResolvedValue({ statusCode: 403, body: 'Mismatch in application/profile' });

    const result = await withApiKeyIdentity(handler, apiKeys)(event({ 'X-API-KEY': 'full-key-value' }));

    expect(result).toEqual({ statusCode: 403, body: 'Mismatch in application/profile' });
  });
});
