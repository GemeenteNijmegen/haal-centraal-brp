export class SubsetError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MissingBsnError extends SubsetError {
  constructor() {
    super('BSN header is missing', 400);
  }
}

export class InvalidBsnError extends SubsetError {
  constructor() {
    super('Invalid BSN format', 400);
  }
}

export class InvalidApplicationProfileError extends SubsetError {
  constructor(fields: string[]) {
    const readableFields = fields.join(', ');
    super(`Mismatch in application/profile for requested fields: ${readableFields}`, 403);
  }
}

export class NoPersonDataError extends SubsetError {
  constructor() {
    super('No person found in responsebody', 404);
  }
}

export class InvalidResourcePathError extends SubsetError {
  constructor(path: string) {
    super(`Invalid resource path: ${path}`, 400);
  }
}

export class EndpointNotFoundError extends SubsetError {
  constructor(endpoint: string) {
    super(`Endpoint not found: ${endpoint}.`, 404);
  }
}

export class HaalCentraalError extends SubsetError {
  constructor(statusCode: number, body: string) {
    super(`${body} - HaalCentraal error`, statusCode);
  }
}