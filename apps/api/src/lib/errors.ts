/**
 * Typed application errors. Services throw these; the error middleware turns
 * them into the single JSON error shape. Anything else becomes a 500.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: Record<string, string>, message = 'Some fields need attention') {
    super(422, 'VALIDATION_FAILED', message, fieldErrors);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = 'BAD_REQUEST') {
    super(400, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Please sign in') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(404, 'NOT_FOUND', `${entity} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(409, 'CONFLICT', message, fieldErrors);
  }
}

/** A business rule refused the operation (wrong status, plan forbids it, …). */
export class RuleError extends AppError {
  constructor(message: string) {
    super(422, 'RULE_VIOLATION', message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', `Too many attempts. Try again in ${retryAfterSeconds} seconds.`);
  }
}
