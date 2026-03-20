import type { Request, Response } from 'express';

import { blacklistToken } from '../../../infrastructure/redis/index.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import { ResponseHelper } from '../../../shared/utils/index.js';
import { AuthService } from '../service/index.js';
import type { LoginUserDto, RegisterUserDto } from '../validation/index.js';

/**
 * Auth Controller — translates HTTP auth requests into service calls.
 *
 * @module modules/auth/controller/auth.controller
 *
 * @description
 * Handles registration, login, and logout. Like all controllers, it
 * contains zero business logic — only HTTP ↔ service translation.
 */
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	/**
	 * POST /auth/register
	 *
	 * Create a new user account and return JWT tokens.
	 */
	async register(req: Request, res: Response): Promise<void> {
		const result = await this.authService.register(req.body as RegisterUserDto);
		ResponseHelper.created(res, result);
	}

	/**
	 * POST /auth/login
	 *
	 * Authenticate with email/password and receive JWT tokens.
	 */
	async login(req: Request, res: Response): Promise<void> {
		const result = await this.authService.login(req.body as LoginUserDto);
		ResponseHelper.success(res, result);
	}

	/**
	 * POST /auth/logout
	 *
	 * Blacklist the current access token so it cannot be reused.
	 * Requires a valid Bearer token in the Authorization header.
	 *
	 * @remarks
	 * The token is added to the Redis blacklist with a TTL matching
	 * its remaining lifetime. After expiry, Redis auto-cleans the key.
	 */
	async logout(req: Request, res: Response): Promise<void> {
		const header = req.headers.authorization;
		if (header == null || !header.startsWith('Bearer ')) {
			throw new UnauthorizedError('Missing Authorization header');
		}

		const token = header.slice(7);
		await blacklistToken(token);

		ResponseHelper.success(res, { message: 'Logged out successfully' });
	}
}
