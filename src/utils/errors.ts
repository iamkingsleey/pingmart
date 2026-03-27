/** Custom application error classes. Each maps to an HTTP status + code. */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) { super(400, 'VALIDATION_ERROR', message); }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') { super(401, 'UNAUTHORIZED', message); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super(403, 'FORBIDDEN', message); }
}
export class NotFoundError extends AppError {
  constructor(resource: string) { super(404, 'NOT_FOUND', `${resource} not found`); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(409, 'CONFLICT', message); }
}
export class UnprocessableError extends AppError {
  constructor(message: string) { super(422, 'UNPROCESSABLE', message); }
}
export class InternalError extends AppError {
  constructor(message = 'An internal error occurred') { super(500, 'INTERNAL_ERROR', message); }
}
