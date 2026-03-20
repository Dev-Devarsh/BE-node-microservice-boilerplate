import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../../config/index.js';
import {
	isTokenBlacklisted,
	isTokenRevokedForUser,
} from '../../infrastructure/redis/index.js';
import { UnauthorizedError } from '../errors/index.js';

/**
 * JWT payload contract — typed to prevent property-access mistakes.
 *
 * @property sub   - User ID (MongoDB ObjectId as string).
 * @property email - User's email address.
 * @property iat   - Issued-at timestamp (seconds since epoch). Set by `jwt.sign()`.
 * @property exp   - Expiration timestamp (seconds since epoch). Set by `jwt.sign()`.
 */
export interface IJwtPayload {
	readonly sub: string;
	readonly email: string;
	readonly iat?: number;
	readonly exp?: number;
}

/**
 * Extend Express Request to carry the decoded token after auth.
 */
declare global {
	namespace Express {
		interface Request {
			user?: IJwtPayload;
		}
	}
}

/**
 * Authentication guard middleware.
 *
 * @description
 * This middleware sits at the route level — only protected routes include it.
 * It performs three checks:
 *
 * 1. **Token presence** — Verifies the `Authorization: Bearer <token>` header exists.
 * 2. **Token validity** — Verifies the JWT signature and expiration via `jwt.verify()`.
 * 3. **Token revocation** — Checks the Redis blacklist for individually revoked
 *    tokens AND the user-level "revoked-before" timestamp (for password changes,
 *    account deactivation, etc.).
 *
 * On success, the decoded payload is attached to `req.user`, making
 * downstream layers auth-transport-agnostic.
 *
 * ### Performance note:
 * The Redis blacklist check adds ~0.5ms per request when Redis is local.
 * If Redis is unavailable, the check is skipped (fail-open) — see the
 * token-blacklist service for the rationale.
 */
export async function authenticate(
	req: Request,
	_res: Response,
	next: NextFunction,
): Promise<void> {
	const header = req.headers.authorization;

	if (header == null || !header.startsWith('Bearer ')) {
		throw new UnauthorizedError('Missing or malformed Authorization header');
	}

	const token = header.slice(7);

	let decoded: IJwtPayload;
	try {
		decoded = jwt.verify(token, env.JWT_SECRET) as IJwtPayload;
	} catch {
		throw new UnauthorizedError('Invalid or expired token');
	}

	const [isBlacklisted, isUserRevoked] = await Promise.all([
		isTokenBlacklisted(token),
		isTokenRevokedForUser(decoded.sub, decoded.iat),
	]);

	if (isBlacklisted || isUserRevoked) {
		throw new UnauthorizedError('Token has been revoked');
	}

	req.user = decoded;
	next();
}
