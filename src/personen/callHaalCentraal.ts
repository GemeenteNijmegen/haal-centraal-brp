import * as https from 'https';
import nodefetch from 'node-fetch';
import { PersonenSecrets } from './initSecrets';

/**
 * Call the Haal Centraal endpoint.
 * @param content Original request by the application
 * @param personenSecrets All requered secrets for the follow-up request
 * @returns Response to the application
 */
export async function callHaalCentraal(content: string, personenSecrets: PersonenSecrets) {

  let rejectUnauthorized = true;
  if (process.env.DEV_MODE! == 'true') {
    rejectUnauthorized = false;
  }

  try {
    const agent = new https.Agent({
      key: personenSecrets.certKey,
      cert: personenSecrets.cert,
      ca: personenSecrets.certCa,
      rejectUnauthorized: rejectUnauthorized,
    });

    // Nodefetch used for agent integration (certs and rejectUnauthorized) instead of native fetch
    const resp = await nodefetch(
      personenSecrets.endpoint,
      {
        method: 'POST',
        body: content,
        headers: {
          'Content-type': 'application/json',
          'X-API-KEY': personenSecrets.brpApiKey,
        },
        agent: agent,
      },
    );

    const data = await resp.json();

    return {
      statusCode: resp.status,
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: 'Internal Server Error',
      headers: { 'Content-Type': 'text/plain' },
    };
  }

}