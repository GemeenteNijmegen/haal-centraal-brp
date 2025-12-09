import { Logger } from '@aws-lambda-powertools/logger';
import { APIGatewayProxyResult } from 'aws-lambda';
import { SubsetError } from '../errors/subset-errors';

export function createErrorResponse(error: unknown, logger: Logger, profileName?: string | undefined): APIGatewayProxyResult {
  if (error instanceof SubsetError) {
    logger.warn('Subset error', {
      error: error.message,
      statusCode: error.statusCode,
      application: profileName,
    });

    return {
      statusCode: error.statusCode,
      body: JSON.stringify({
        error: error.message,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  logger.error('Unexpected error', { error });

  return {
    statusCode: 500,
    body: JSON.stringify({
      error: 'Internal server error',
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}