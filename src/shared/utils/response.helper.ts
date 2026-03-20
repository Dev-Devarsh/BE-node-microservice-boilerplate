import type { Response } from 'express';

import type { IApiResponse, IErrorDetail, IPaginationMeta } from '../types/index.js';

/**
 * Response Helper — enforces the standardized JSON envelope on every response.
 *
 * Architectural reasoning: Centralizing response construction guarantees that
 * no controller can accidentally return a non-conforming shape. Mobile clients
 * depend on the `{ success, data, error, meta }` contract being upheld on
 * every single endpoint.
 */
export class ResponseHelper {
	/** Send a success response with data and optional pagination. */
	static success<T>(res: Response, data: T, statusCode = 200, meta?: IPaginationMeta): void {
		const body: IApiResponse<T> = {
			success: true,
			data,
			error: null,
			meta: meta ?? null,
		};
		res.status(statusCode).json(body);
	}

	/** Send a structured error response. */
	static error(res: Response, statusCode: number, error: IErrorDetail): void {
		const body: IApiResponse<null> = {
			success: false,
			data: null,
			error,
			meta: null,
		};
		res.status(statusCode).json(body);
	}

	/** 201 Created — convenience for POST creation endpoints. */
	static created<T>(res: Response, data: T): void {
		ResponseHelper.success(res, data, 201);
	}

	/** 204 No Content — convenience for DELETE endpoints. */
	static noContent(res: Response): void {
		res.status(204).end();
	}
}
