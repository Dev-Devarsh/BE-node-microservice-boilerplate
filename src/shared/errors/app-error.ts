/**
 * Custom Application Error Hierarchy
 *
 * Architectural reasoning: Distinguishing operational errors (expected failures
 * like invalid input, resource not found) from programming errors (bugs, null
 * derefs) is critical for production stability. Operational errors yield a
 * structured JSON response; programming errors trigger alerting and a generic
 * 500 — never leaking internals to the client.
 */
export class AppError extends Error {
	/** HTTP status code to send in the response. */
	public readonly statusCode: number;

	/**
	 * `true` = operational (expected, safe to show message to client).
	 * `false` = programming error (bug — log + generic 500).
	 */
	public readonly isOperational: boolean;

	/** Machine-readable error code for client-side switch/case handling. */
	public readonly errorCode: string;

	constructor(
		message: string,
		statusCode: number,
		errorCode: string,
		isOperational = true,
	) {
		super(message);
		this.statusCode = statusCode;
		this.errorCode = errorCode;
		this.isOperational = isOperational;

		Object.setPrototypeOf(this, new.target.prototype);
		Error.captureStackTrace(this, this.constructor);
	}
}

/** 400 — malformed request payload. */
export class BadRequestError extends AppError {
	constructor(message = 'Bad request', errorCode = 'BAD_REQUEST') {
		super(message, 400, errorCode);
	}
}

/** 401 — missing or invalid authentication credentials. */
export class UnauthorizedError extends AppError {
	constructor(message = 'Unauthorized', errorCode = 'UNAUTHORIZED') {
		super(message, 401, errorCode);
	}
}

/** 403 — authenticated but insufficient permissions. */
export class ForbiddenError extends AppError {
	constructor(message = 'Forbidden', errorCode = 'FORBIDDEN') {
		super(message, 403, errorCode);
	}
}

/** 404 — requested resource does not exist. */
export class NotFoundError extends AppError {
	constructor(message = 'Resource not found', errorCode = 'NOT_FOUND') {
		super(message, 404, errorCode);
	}
}

/** 409 — conflict with existing state (e.g. duplicate email). */
export class ConflictError extends AppError {
	constructor(message = 'Conflict', errorCode = 'CONFLICT') {
		super(message, 409, errorCode);
	}
}

/** 422 — semantically invalid request (e.g. validation failure). */
export class ValidationError extends AppError {
	public readonly details: ReadonlyArray<{ readonly field: string; readonly message: string }>;

	constructor(
		details: ReadonlyArray<{ readonly field: string; readonly message: string }>,
		message = 'Validation failed',
	) {
		super(message, 422, 'VALIDATION_ERROR');
		this.details = details;
	}
}

/** 429 — rate limit exceeded. */
export class TooManyRequestsError extends AppError {
	constructor(message = 'Too many requests', errorCode = 'RATE_LIMIT_EXCEEDED') {
		super(message, 429, errorCode);
	}
}
