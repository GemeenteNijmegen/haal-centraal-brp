import { APIGatewayProxyEvent } from 'aws-lambda';
import { callHaalCentraal } from '../../callHaalCentraal';
import { getApplicationProfile, validateFields } from '../../validateFields';

const fakedInitSecrets = {
  certKey: 'test-cert-key',
  cert: 'test-cert',
  certCa: 'test-cert-ca',
  endpoint: 'https://test.endpoint',
  brpApiKey: 'test-brp-api-key',
};

jest.mock('../../initSecrets', () => ({
  initSecrets: jest.fn(() => Promise.resolve(fakedInitSecrets)),
}));

jest.mock('../../callHaalCentraal', () => ({
  callHaalCentraal: jest.fn(),
}));

jest.mock('../../validateFields', () => ({
  getApplicationProfile: jest.fn(),
  validateFields: jest.fn(),
}));

import {
  addOntbindingField,
  filterDissolvedPartners,
  handler,
} from '../partner-filter.lambda';

const mockCallHaalCentraal = callHaalCentraal as jest.MockedFunction<
  typeof callHaalCentraal
>;
const mockGetApplicationProfile =
  getApplicationProfile as jest.MockedFunction<typeof getApplicationProfile>;
const mockValidateFields = validateFields as jest.MockedFunction<
  typeof validateFields
>;

describe('partner filter lambda handler', () => {
  beforeEach(() => {
    mockCallHaalCentraal.mockReset();
    mockGetApplicationProfile.mockReset();
    mockValidateFields.mockReset();

    delete process.env.TRACING_ENABLED;

    mockGetApplicationProfile.mockResolvedValue({
      name: 'ApiKeyTest',
      fields: [],
    });
    mockValidateFields.mockReturnValue(true);
  });

  interface CreateEventOptions {
    apiKey?: string;
    apiKeyId?: string;
    body?: Record<string, unknown>;
  }

  const createValidEvent = (
    options: CreateEventOptions = {},
  ): APIGatewayProxyEvent => {
    const {
      apiKey = 'test-api-key',
      apiKeyId = 'test-api-key-id',
      body = {
        type: 'RaadpleegMetBurgerservicenummer',
        burgerservicenummer: ['999971785'],
        fields: ['burgerservicenummer', 'naam.volledigeNaam'],
      },
    } = options;

    return {
      body: JSON.stringify(body),
      httpMethod: 'POST',
      path: '/personen/partnerfilter',
      resource: '/personen/partnerfilter',
      requestContext: {
        identity: {
          apiKey,
          apiKeyId,
        },
        httpMethod: 'POST',
        path: '/personen/partnerfilter',
        resourcePath: '/personen/partnerfilter',
      },
    } as APIGatewayProxyEvent;
  };

  interface MockHaalCentraalOptions {
    statusCode?: number;
    responseData?: Record<string, unknown>;
    headers?: { 'Content-Type': string };
  }

  const setupApplicationProfile = (fields: string[]) => {
    mockGetApplicationProfile.mockResolvedValue({
      name: 'ApiKeyTest',
      fields,
    });
  };

  const setupHaalCentraalResponse = (
    options: MockHaalCentraalOptions = {},
  ) => {
    const statusCode = options.statusCode ?? 200;
    const responseData = options.responseData ?? {
      personen: [
        {
          burgerservicenummer: '999971785',
          naam: {
            volledigeNaam: "Sem van 't Hul",
          },
        },
      ],
    };
    const headers = options.headers ?? {
      'Content-Type': 'application/json',
    };

    mockCallHaalCentraal.mockResolvedValue({
      statusCode,
      body: JSON.stringify(responseData),
      headers,
    });
  };

  const getForwardedRequestBody = (): Record<string, unknown> => {
    const firstCall = mockCallHaalCentraal.mock.calls[0];
    return JSON.parse(firstCall[0] as string);
  };

  const expectJsonErrorResponse = (
    result: {
      statusCode: number;
      body: string;
      headers?: Record<string, string>;
    },
    expectedStatusCode: number,
  ) => {
    expect(result.statusCode).toBe(expectedStatusCode);
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(result.body)).toEqual({
      error: expect.any(String),
    });
  };

  describe('handler - smoke test', () => {
    it('returns 200 and calls callHaalCentraal with mocked secrets for a valid request', async () => {
      const requestBody = {
        type: 'RaadpleegMetBurgerservicenummer',
        burgerservicenummer: ['999971785'],
        fields: ['burgerservicenummer', 'naam.volledigeNaam'],
      };

      setupApplicationProfile(requestBody.fields);
      setupHaalCentraalResponse();

      const event = createValidEvent({ body: requestBody });
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      expect(result.headers).toEqual({
        'Content-Type': 'application/json',
      });

      expect(mockGetApplicationProfile).toHaveBeenCalledWith('test-api-key');
      expect(mockValidateFields).toHaveBeenCalledWith(
        requestBody.fields,
        requestBody.fields,
      );

      expect(mockCallHaalCentraal).toHaveBeenCalledTimes(1);
      expect(mockCallHaalCentraal).toHaveBeenCalledWith(
        JSON.stringify(requestBody),
        fakedInitSecrets,
      );

      expect(JSON.parse(result.body)).toEqual({
        personen: [
          {
            burgerservicenummer: '999971785',
            naam: {
              volledigeNaam: "Sem van 't Hul",
            },
          },
        ],
      });
    });
  });

  describe('pure helper: addOntbindingField', () => {
    const addFieldCases: Array<{
      description: string;
      input: string[];
      expected: string[];
    }> = [
      {
        description: 'appends ontbinding field when it is missing',
        input: ['partners.naam.voornamen', 'partners.geboorte.datum'],
        expected: [
          'partners.naam.voornamen',
          'partners.geboorte.datum',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
      },
      {
        description:
          'returns fields unchanged when ontbinding field is already present',
        input: [
          'partners.naam.voornamen',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
        expected: [
          'partners.naam.voornamen',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
      },
    ];

    it.each(addFieldCases)('$description', ({ input, expected }) => {
      expect(addOntbindingField(input)).toEqual(expected);
    });
  });

  describe('pure helper: filterDissolvedPartners', () => {
    const filterCases: Array<{
      description: string;
      input: Record<string, unknown>;
      expected: Record<string, unknown>;
    }> = [
      {
        description: 'when partner has ontbindingHuwelijkPartnerschap',
        input: {
          personen: [
            {
              burgerservicenummer: '999999333',
              partners: [
                {
                  burgerservicenummer: '999993240',
                  naam: {
                    voornamen: 'Sherida',
                  },
                  ontbindingHuwelijkPartnerschap: {
                    datum: {
                      datum: '2000-03-08',
                    },
                  },
                },
              ],
            },
          ],
        },
        expected: {
          personen: [
            {
              burgerservicenummer: '999999333',
              partners: [],
            },
          ],
        },
      },
      {
        description: 'when partner has no ontbindingHuwelijkPartnerschap',
        input: {
          personen: [
            {
              burgerservicenummer: '999999333',
              partners: [
                {
                  burgerservicenummer: '999993240',
                  naam: {
                    voornamen: 'Sherida',
                  },
                },
              ],
            },
          ],
        },
        expected: {
          personen: [
            {
              burgerservicenummer: '999999333',
              partners: [
                {
                  burgerservicenummer: '999993240',
                  naam: {
                    voornamen: 'Sherida',
                  },
                },
              ],
            },
          ],
        },
      },
      {
        description: 'when partners array is empty',
        input: {
          personen: [
            {
              burgerservicenummer: '999999333',
              partners: [],
            },
          ],
        },
        expected: {
          personen: [
            {
              burgerservicenummer: '999999333',
              partners: [],
            },
          ],
        },
      },
      {
        description: 'when persoon has no partners property',
        input: {
          personen: [
            {
              burgerservicenummer: '999999333',
              naam: {
                volledigeNaam: 'Nasier Boeddhoe',
              },
            },
          ],
        },
        expected: {
          personen: [
            {
              burgerservicenummer: '999999333',
              naam: {
                volledigeNaam: 'Nasier Boeddhoe',
              },
            },
          ],
        },
      },
    ];

    it.each(filterCases)(
      'returns the expected filtered response $description',
      ({ input, expected }) => {
        expect(filterDissolvedPartners(input)).toEqual(expected);
      },
    );

    it('removes only dissolved partners when response contains one active and one dissolved partner', () => {
      const input = {
        personen: [
          {
            burgerservicenummer: '999999333',
            partners: [
              {
                burgerservicenummer: '111111111',
                naam: {
                  voornamen: 'Active Partner',
                },
              },
              {
                burgerservicenummer: '222222222',
                naam: {
                  voornamen: 'Dissolved Partner',
                },
                ontbindingHuwelijkPartnerschap: {
                  datum: {
                    datum: '2000-03-08',
                  },
                },
              },
            ],
          },
        ],
      };

      const result = filterDissolvedPartners(input);

      expect(result).toEqual({
        personen: [
          {
            burgerservicenummer: '999999333',
            partners: [
              {
                burgerservicenummer: '111111111',
                naam: {
                  voornamen: 'Active Partner',
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe('handler - request field enrichment', () => {
    const requestFieldCases: Array<{
      description: string;
      fields: string[];
      expectedFields: string[];
    }> = [
      {
        description: 'adds ontbinding field when request contains partners',
        fields: ['burgerservicenummer', 'partners'],
        expectedFields: [
          'burgerservicenummer',
          'partners',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
      },
      {
        description:
          'adds ontbinding field when request contains nested partner fields',
        fields: ['partners.naam.voornamen', 'partners.geboorte.datum'],
        expectedFields: [
          'partners.naam.voornamen',
          'partners.geboorte.datum',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
      },
      {
        description:
          'does not duplicate ontbinding field when it is already present',
        fields: [
          'partners.naam.voornamen',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
        expectedFields: [
          'partners.naam.voornamen',
          'partners.ontbindingHuwelijkPartnerschap',
        ],
      },
      {
        description:
          'does not add ontbinding field when request contains no partner fields',
        fields: ['burgerservicenummer', 'naam.volledigeNaam'],
        expectedFields: ['burgerservicenummer', 'naam.volledigeNaam'],
      },
    ];

    it.each(requestFieldCases)(
      '$description',
      async ({ fields, expectedFields }) => {
        const requestBody = {
          type: 'RaadpleegMetBurgerservicenummer',
          burgerservicenummer: ['999971785'],
          fields,
        };

        setupApplicationProfile(fields);
        setupHaalCentraalResponse();

        const event = createValidEvent({ body: requestBody });
        const result = await handler(event);
        const forwardedRequestBody = getForwardedRequestBody();

        expect(result.statusCode).toBe(200);
        expect(forwardedRequestBody).toEqual({
          type: 'RaadpleegMetBurgerservicenummer',
          burgerservicenummer: ['999971785'],
          fields: expectedFields,
        });
      },
    );
  });

  describe('handler - response partner filtering', () => {
    const activePartner = {
      burgerservicenummer: '111111111',
      naam: {
        voornamen: 'Active Partner',
      },
    };

    const dissolvedPartner = {
      burgerservicenummer: '222222222',
      naam: {
        voornamen: 'Dissolved Partner',
      },
      ontbindingHuwelijkPartnerschap: {
        datum: {
          datum: '2000-03-08',
        },
      },
    };

    const responseFilteringCases: Array<{
      description: string;
      requestFields: string[];
      responseData: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }> = [
      {
        description:
          'keeps active partner when request contains partner fields',
        requestFields: ['partners.naam.voornamen', 'partners.geboorte.datum'],
        responseData: {
          personen: [
            {
              partners: [activePartner],
            },
          ],
        },
        expectedData: {
          personen: [
            {
              partners: [activePartner],
            },
          ],
        },
      },
      {
        description:
          'removes dissolved partner and returns empty partners array when request contains partner fields',
        requestFields: ['partners.naam.voornamen', 'partners.geboorte.datum'],
        responseData: {
          personen: [
            {
              partners: [dissolvedPartner],
            },
          ],
        },
        expectedData: {
          personen: [
            {
              partners: [],
            },
          ],
        },
      },
      {
        description:
          'keeps response unchanged when request contains no partner fields even if response contains dissolved partner data',
        requestFields: ['burgerservicenummer', 'naam.volledigeNaam'],
        responseData: {
          personen: [
            {
              burgerservicenummer: '999971785',
              partners: [dissolvedPartner],
            },
          ],
        },
        expectedData: {
          personen: [
            {
              burgerservicenummer: '999971785',
              partners: [dissolvedPartner],
            },
          ],
        },
      },
      {
        description:
          'removes only dissolved partner when response contains one active and one dissolved partner',
        requestFields: ['partners.naam.voornamen', 'partners.geboorte.datum'],
        responseData: {
          personen: [
            {
              partners: [activePartner, dissolvedPartner],
            },
          ],
        },
        expectedData: {
          personen: [
            {
              partners: [activePartner],
            },
          ],
        },
      },
    ];

    it.each(responseFilteringCases)(
      '$description',
      async ({ requestFields, responseData, expectedData }) => {
        const requestBody = {
          type: 'RaadpleegMetBurgerservicenummer',
          burgerservicenummer: ['999971785'],
          fields: requestFields,
        };

        setupApplicationProfile(requestFields);
        setupHaalCentraalResponse({ responseData });

        const event = createValidEvent({ body: requestBody });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        expect(JSON.parse(result.body)).toEqual(expectedData);
      },
    );
  });

  describe('handler - error paths', () => {
    const defaultRequestBody = {
      type: 'RaadpleegMetBurgerservicenummer',
      burgerservicenummer: ['999971785'],
      fields: ['burgerservicenummer', 'naam.volledigeNaam'],
    };

    it('returns 403 and does not call Haal Centraal when validateFields returns false', async () => {
      setupApplicationProfile(['burgerservicenummer']);
      mockValidateFields.mockReturnValue(false);

      const event = createValidEvent({ body: defaultRequestBody });
      const result = await handler(event);

      expectJsonErrorResponse(result as any, 403);
      expect(mockCallHaalCentraal).not.toHaveBeenCalled();
    });

    const noPersonDataCases: Array<{
      description: string;
      responseData: Record<string, unknown>;
    }> = [
      {
        description: 'when personen property is missing',
        responseData: {},
      },
      {
        description: 'when personen is null',
        responseData: {
          personen: null,
        },
      },
      {
        description: 'when personen array is empty',
        responseData: {
          personen: [],
        },
      },
    ];

    it.each(noPersonDataCases)(
      'returns 404 $description',
      async ({ responseData }) => {
        setupApplicationProfile(defaultRequestBody.fields);
        setupHaalCentraalResponse({ responseData });

        const event = createValidEvent({ body: defaultRequestBody });
        const result = await handler(event);

        expectJsonErrorResponse(result as any, 404);
        expect(mockCallHaalCentraal).toHaveBeenCalledTimes(1);
      },
    );

    const upstreamErrorCases: Array<{
      description: string;
      statusCode: number;
      responseData: Record<string, unknown>;
    }> = [
      {
        description: 'when Haal Centraal returns a 503 response',
        statusCode: 503,
        responseData: {
          error: 'upstream unavailable',
        },
      },
      {
        description: 'when Haal Centraal returns a 500 response',
        statusCode: 500,
        responseData: {
          error: 'internal server error',
        },
      },
    ];

    it.each(upstreamErrorCases)(
      'returns the upstream status code $description',
      async ({ statusCode, responseData }) => {
        setupApplicationProfile(defaultRequestBody.fields);
        setupHaalCentraalResponse({
          statusCode,
          responseData,
        });

        const event = createValidEvent({ body: defaultRequestBody });
        const result = await handler(event);

        expectJsonErrorResponse(result as any, statusCode);
        expect(mockCallHaalCentraal).toHaveBeenCalledTimes(1);
      },
    );

    it('returns 500 when Haal Centraal returns invalid JSON', async () => {
      setupApplicationProfile(defaultRequestBody.fields);
      mockCallHaalCentraal.mockResolvedValue({
        statusCode: 200,
        body: 'invalid json response',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const event = createValidEvent({ body: defaultRequestBody });
      const result = await handler(event);

      expectJsonErrorResponse(result as any, 500);
      expect(mockCallHaalCentraal).toHaveBeenCalledTimes(1);
    });
  });
});
