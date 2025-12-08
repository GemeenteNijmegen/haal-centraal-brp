import { Logger } from '@aws-lambda-powertools/logger';
import {
  SubsetError,
  MissingBsnError,
  InvalidBsnError,
  InvalidApplicationProfileError,
  NoPersonDataError,
  InvalidResourcePathError,
  EndpointNotFoundError,
  HaalCentraalError,
} from '../../errors/subset-errors';
import { createErrorResponse } from '../error-response';

describe('createErrorResponse', () => {
  let logger: Logger;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger();
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation();
    errorSpy = jest.spyOn(logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('SubsetError handling', () => {
    const subsetErrorTestCases: [string, SubsetError, number][] = [
      ['MissingBsnError', new MissingBsnError(), 400],
      ['InvalidBsnError', new InvalidBsnError(), 400],
      ['InvalidApplicationProfileError', new InvalidApplicationProfileError(['naam', 'adres']), 403],
      ['NoPersonDataError', new NoPersonDataError(), 404],
      ['InvalidResourcePathError', new InvalidResourcePathError('/invalid/path'), 400],
      ['EndpointNotFoundError', new EndpointNotFoundError('missing'), 404],
      ['HaalCentraalError 400', new HaalCentraalError(400, 'Bad request from upstream'), 400],
      ['HaalCentraalError 503', new HaalCentraalError(503, 'Service unavailable'), 503],
    ];

    it.each(subsetErrorTestCases)(
      'should handle %s with correct status code and response structure',
      (_errorType, error, expectedStatusCode) => {
        const result = createErrorResponse(error, logger);

        expect(result.statusCode).toBe(expectedStatusCode);

        const body = JSON.parse(result.body);
        expect(body).toHaveProperty('error');
        expect(typeof body.error).toBe('string');
        expect(body.error.length).toBeGreaterThan(0);

        expect(warnSpy).toHaveBeenCalledWith('Subset error', expect.objectContaining({
          error: error.message,
          statusCode: expectedStatusCode,
        }));
        expect(errorSpy).not.toHaveBeenCalled();
      },
    );

    it('should include profile name in logging when provided', () => {
      const error = new MissingBsnError();
      const profileName = 'TestApplication';

      createErrorResponse(error, logger, profileName);

      expect(warnSpy).toHaveBeenCalledWith('Subset error', expect.objectContaining({
        application: profileName,
      }));
    });

    it('should not include profile name in logging when not provided', () => {
      const error = new MissingBsnError();

      createErrorResponse(error, logger);

      expect(warnSpy).toHaveBeenCalledWith('Subset error', expect.objectContaining({
        application: undefined,
      }));
    });
  });

  describe('InvalidApplicationProfileError field handling', () => {
    const fieldTestCases: [string, string[]][] = [
      ['single field', ['naam']],
      ['multiple fields', ['naam', 'adres', 'geboortedatum']],
      ['empty array', []],
    ];

    it.each(fieldTestCases)(
      'should include all fields in error message for %s',
      (_description, fields) => {
        const error = new InvalidApplicationProfileError(fields);
        const result = createErrorResponse(error, logger);

        const body = JSON.parse(result.body);
        fields.forEach(field => {
          expect(body.error).toContain(field);
        });
      },
    );
  });

  describe('EndpointNotFoundError parameter handling', () => {
    it('should include endpoint and available endpoints in error message', () => {
      const missingEndpoint = 'missing-endpoint';
      const error = new EndpointNotFoundError(missingEndpoint);

      const result = createErrorResponse(error, logger);
      const body = JSON.parse(result.body);

      expect(body.error).toContain(missingEndpoint);
    });
  });

  describe('InvalidResourcePathError parameter handling', () => {
    it('should include path in error message', () => {
      const invalidPath = '/some/invalid/path';
      const error = new InvalidResourcePathError(invalidPath);

      const result = createErrorResponse(error, logger);
      const body = JSON.parse(result.body);

      expect(body.error).toContain(invalidPath);
    });
  });

  describe('Unexpected error handling', () => {
    const unexpectedErrorTestCases: [string, unknown][] = [
      ['generic Error', new Error('Something went wrong')],
      ['string', 'string error'],
      ['number', 42],
      ['null', null],
      ['undefined', undefined],
      ['object', { unexpected: 'error' }],
    ];

    it.each(unexpectedErrorTestCases)(
      'should return 500 for %s',
      (_errorType, error) => {
        const result = createErrorResponse(error, logger);

        expect(result.statusCode).toBe(500);

        const body = JSON.parse(result.body);
        expect(body).toHaveProperty('error');
        expect(typeof body.error).toBe('string');

        expect(errorSpy).toHaveBeenCalledWith('Unexpected error', { error });
        expect(warnSpy).not.toHaveBeenCalled();
      },
    );
  });
});