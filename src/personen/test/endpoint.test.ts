import fetch from 'node-fetch';
import { callHaalCentraal } from '../callHaalCentraal';

jest.mock('node-fetch', () => jest.fn());

describe('callHaalCentraal', () => {
  it('should make an HTTPS call and return the response', async () => {
    const mockAgent = jest.fn();
    jest.mock('https', () => ({
      Agent: mockAgent,
    }));

    //const fetchSpy = jest.spyOn(global, 'fetch');

    (fetch as jest.Mock).mockResolvedValueOnce({
      json: jest.fn().mockResolvedValue({ data: 'response' }),
      status: 200,
    });

    // fetchSpy
    // as any as Response

    // jest.spyOn(initSecrets, '')
    //jest.spyOn(utils, 'environmentVariables').mockReturnValue({ ...defaultEnvVars });
    // jest.spyOn(initSecrets, 'envKeys');

    const secrets = {
      certKey: process.env.CERTIFICATE_KEY!,
      cert: process.env.CERTIFICATE!,
      certCa: process.env.CERTIFICATE_CA!,
      endpoint: process.env.LAYER7_ENDPOINT!,
      brpApiKey: process.env.BRP_API_KEY_ARN!,
    };

    const content = JSON.stringify({ key: 'value' });

    const result = await callHaalCentraal(content, secrets);

    expect(fetch).toHaveBeenCalledWith(secrets.endpoint, expect.any(Object));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ data: 'response' });
  });

  it('should return a 500 error on failure, missing Certificates', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));

    const secrets = { certKey: '', cert: '', certCa: '', endpoint: '', brpApiKey: process.env.BRP_API_KEY_ARN! };
    const result = await callHaalCentraal('content', secrets);

    expect(result.statusCode).toBe(500);
    expect(result.body).toBe('Internal Server Error');
  });

  it('should return a 500 error on failure, missing API Key', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Failed to fetch'));

    const secrets = {
        certKey: process.env.CERTIFICATE_KEY!,
        cert: process.env.CERTIFICATE!,
        certCa: process.env.CERTIFICATE_CA!,
        endpoint: process.env.LAYER7_ENDPOINT!,
        brpApiKey: '',
      };
    const result = await callHaalCentraal('content', secrets);

    expect(result.statusCode).toBe(500);
    expect(result.body).toBe('Internal Server Error');
  });
});
