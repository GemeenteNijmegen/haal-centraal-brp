type Handler = (event: any) => Promise<any>;

export interface LocalApiKey {
  id: string;
  value: string;
}

/**
 * Wrap a REST API lambda handler so it gets the API key in its event, like it does on AWS.
 *
 * MiniStack checks the X-API-KEY header against the usage plan, but does not put the key in
 * requestContext.identity.apiKey and apiKeyId. The handlers look up the application profile
 * with that value, so it is filled in here from the header, which MiniStack has already checked.
 * @param handler The real handler from src/
 * @param apiKeys API keys of the local stack, to find the id that belongs to a key value
 * @returns Handler that fills in the API key and calls the real handler
 */
export function withApiKeyIdentity(handler: Handler, apiKeys: LocalApiKey[]): Handler {
  return async (event: any) => {
    const header = Object.entries(event.headers ?? {})
      .find(([name]) => name.toLowerCase() === 'x-api-key');
    if (!header) {
      return handler(event);
    }

    const apiKey = header[1] as string;
    const apiKeyId = apiKeys.find(key => key.value === apiKey)?.id;
    const identity = { ...event.requestContext?.identity, apiKey };
    if (apiKeyId) {
      identity.apiKeyId = apiKeyId;
    }

    return handler({
      ...event,
      requestContext: { ...event.requestContext, identity },
    });
  };
}
