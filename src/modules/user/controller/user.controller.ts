import type { Request, Response } from 'express';

import { BadRequestError, UnauthorizedError } from '../../../shared/errors/index.js';
import { ResponseHelper } from '../../../shared/utils/index.js';
import { UserService } from '../service/index.js';
import type { PaginationDto, UpdateUserDto } from '../validation/index.js';
import { paginationSchema } from '../validation/index.js';

/**
 * User Controller — HTTP-to-service adapter.
 *
 * @module modules/user/controller/user.controller
 *
 * @description
 * Controllers have exactly ONE responsibility: translate HTTP semantics
 * (request params, query strings, body) into service method calls, then
 * translate the service response into the standardized JSON envelope.
 *
 * ### Rules:
 * - Controllers contain ZERO business logic.
 * - Controllers never import repositories or models directly.
 * - Controllers never access the database.
 * - All data comes from `req`, all output goes through `ResponseHelper`.
 */
export class UserController {
	constructor(private readonly userService: UserService) {}

	/**
	 * GET /users/:id
	 *
	 * Retrieve a single user by their MongoDB ObjectId.
	 */
	async getUser(req: Request, res: Response): Promise<void> {
		const id = req.params['id'];
		if (id == null || Array.isArray(id)) {
			throw new BadRequestError('User ID is required');
		}
		const user = await this.userService.getUserById(id);
		ResponseHelper.success(res, user);
	}

	/**
	 * GET /users?page=1&limit=20&role=admin
	 *
	 * Retrieve a paginated list of users with optional role filtering.
	 */
	async getUsers(req: Request, res: Response): Promise<void> {
		const parsed = paginationSchema.safeParse(req.query);
		const pagination: PaginationDto = parsed.success
			? parsed.data
			: { page: 1, limit: 20 };

		const role = req.query['role'] as 'user' | 'admin' | undefined;

		const { users, meta } = await this.userService.getUsers(
			pagination.page,
			pagination.limit,
			role,
		);
		ResponseHelper.success(res, users, 200, meta);
	}

	/**
	 * PATCH /users/:id
	 *
	 * Update user profile fields (firstName, lastName).
	 */
	async updateUser(req: Request, res: Response): Promise<void> {
		const id = req.params['id'];
		if (id == null || Array.isArray(id)) {
			throw new BadRequestError('User ID is required');
		}
		const user = await this.userService.updateUser(id, req.body as UpdateUserDto);
		ResponseHelper.success(res, user);
	}

	/**
	 * DELETE /users/:id
	 *
	 * Soft-delete (deactivate) a user account.
	 * Users can only deactivate their own account.
	 */
	async deleteUser(req: Request, res: Response): Promise<void> {
		const id = req.params['id'];
		if (id == null || Array.isArray(id)) {
			throw new BadRequestError('User ID is required');
		}

		if (req.user == null) {
			throw new UnauthorizedError();
		}

		if (req.user.sub !== id) {
			throw new UnauthorizedError('Cannot deactivate another user');
		}

		await this.userService.deactivateUser(id);
		ResponseHelper.noContent(res);
	}

	/**
	 * GET /users/analytics/retention?startDate=...&endDate=...
	 *
	 * Monthly active user retention statistics with session lookup.
	 */
	async getRetentionStats(req: Request, res: Response): Promise<void> {
		const startDate = new Date(req.query['startDate'] as string);
		const endDate = new Date(req.query['endDate'] as string);

		if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
			throw new BadRequestError('Valid startDate and endDate query params required');
		}

		const stats = await this.userService.getRetentionStats(startDate, endDate);
		ResponseHelper.success(res, stats);
	}

	/**
	 * GET /users/analytics/roles
	 *
	 * User count grouped by role (admin, user).
	 */
	async getRoleDistribution(_req: Request, res: Response): Promise<void> {
		const stats = await this.userService.getRoleDistribution();
		ResponseHelper.success(res, stats);
	}

	/**
	 * GET /users/analytics/trends?startDate=...&endDate=...&granularity=month
	 *
	 * Registration trends over time with configurable granularity.
	 */
	async getRegistrationTrends(req: Request, res: Response): Promise<void> {
		const startDate = new Date(req.query['startDate'] as string);
		const endDate = new Date(req.query['endDate'] as string);
		const granularity = (req.query['granularity'] as 'day' | 'week' | 'month') ?? 'month';

		if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
			throw new BadRequestError('Valid startDate and endDate query params required');
		}

		const trends = await this.userService.getRegistrationTrends(
			startDate,
			endDate,
			granularity,
		);
		ResponseHelper.success(res, trends);
	}
}
