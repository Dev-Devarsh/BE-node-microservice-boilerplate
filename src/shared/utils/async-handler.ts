import type { NextFunction, Request, Response } from 'express';

/**
 * Wraps async Express route handlers to automatically catch rejected promises
 * and forward them to the centralized error-handling middleware.
 *
 * Architectural reasoning: Express 4 does not natively catch async errors.
 * Without this wrapper every handler would need its own try/catch, creating
 * boilerplate and risk of unhandled rejections crashing the process.
 */
export const asyncHandler =
	(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
	(req: Request, res: Response, next: NextFunction): void => {
		Promise.resolve(fn(req, res, next)).catch(next);
	};
