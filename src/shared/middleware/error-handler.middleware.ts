import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/index.js';
import { AppError, ValidationError } from '../errors/index.js';
import { logger } from '../utils/logger.js';
import { ResponseHelper } from '../utils/response.helper.js';

/**
 * Global error-handling middleware — the single exit point for all errors.
 *
 * Architectural reasoning: Centralizing error handling ensures:
 * 1. Operational errors (AppError) return structured JSON with the correct status.
 * 2. Programming errors return a generic 500 with NO stack trace in production.
 * 3. Every error is logged with full context for post-mortem debugging.
 * 4. The response envelope contract is never violated, even on errors.
 */
export function globalErrorHandler(
	err: Error,
	_req: Request,
	res: Response,
	_next: NextFunction,
): void {
	if (err instanceof ValidationError) {
		ResponseHelper.error(res, err.statusCode, {
			code: err.errorCode,
			message: err.message,
			details: err.details,
		});
		return;
	}

	if (err instanceof AppError) {
		if (!err.isOperational) {
			logger.fatal({ err }, 'PROGRAMMING ERROR — this is a bug that must be fixed');
		} else {
			logger.warn({ err, statusCode: err.statusCode }, err.message);
		}

		ResponseHelper.error(res, err.statusCode, {
			code: err.errorCode,
			message: err.isOperational ? err.message : 'Internal server error',
		});
		return;
	}

	logger.fatal({ err }, 'UNHANDLED ERROR — not an AppError instance');

	const isDev = env.NODE_ENV === 'development';

	ResponseHelper.error(res, 500, {
		code: 'INTERNAL_SERVER_ERROR',
		message: isDev ? err.message : 'Internal server error',
	});
}
