import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

import { ValidationError } from '../errors/index.js';

/**
 * Zod-powered request validation middleware factory.
 *
 * Architectural reasoning: Validation at the middleware layer means invalid
 * payloads are rejected BEFORE reaching the controller, keeping business logic
 * clean. The Zod schema serves as a single source of truth for both runtime
 * validation and TypeScript type inference.
 *
 * @param schema — Zod schema to validate `req.body` against.
 */
export function validate(schema: ZodSchema) {
	return (req: Request, _res: Response, next: NextFunction): void => {
		const result = schema.safeParse(req.body);

		if (!result.success) {
			const details = result.error.issues.map((issue) => ({
				field: issue.path.join('.'),
				message: issue.message,
			}));
			throw new ValidationError(details);
		}

		req.body = result.data as Record<string, unknown>;
		next();
	};
}
