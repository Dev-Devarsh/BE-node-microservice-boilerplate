import jwt from 'jsonwebtoken';

import { logger } from '../../shared/utils/logger.js';

import { getRedisClient } from './redis.client.js';

/**
 * Token Blacklist Service — Redis-backed JWT revocation.
 *
 * @module infrastructure/redis/token-blacklist.service
 *
 * @description
 * JWTs are stateless — once issued, they cannot be "invalidated" without
 * a server-side check. This service provides that check by storing
 * revoked token identifiers in Redis with a TTL matching the token's
 * remaining lifetime.
 *
 * ### When tokens are blacklisted:
 * - **Logout** — the current access token is blacklisted.
 * - **Password change** — all existing tokens for the user are blacklisted.
 * - **Account deactivation** — all tokens are blacklisted.
 *
 * ### How it works:
 * 1. On logout/revocation, the JWT's unique `jti` (or the full token) is
 *    stored in Redis with `EX` = remaining seconds until expiry.
 * 2. On every authenticated request, the auth middleware calls
 *    `isBlacklisted()` to check if the token has been revoked.
 * 3. Once the token's natural expiry passes, Redis auto-deletes the
 *    key — zero manual cleanup.
 *
 * ### Graceful degradation:
 * If Redis is unavailable, `isBlacklisted()` returns `false` (allow).
 * This is a conscious trade-off: availability over strict revocation.
 * For high-security scenarios, this should return `true` (deny).
 */

const BLACKLIST_NAMESPACE = 'token:blacklist';

/**
 * Add a token to the blacklist.
 *
 * @param token - The raw JWT string to blacklist.
 *
 * @remarks
 * The TTL is calculated from the token's `exp` claim. If the token
 * has no `exp` (shouldn't happen with our config), it defaults to
 * 24 hours as a safety net.
 *
 * @example
 * ```ts
 * await blacklistToken(req.headers.authorization.split(' ')[1]);
 * ```
 */
export async function blacklistToken(token: string): Promise<void> {
	const client = getRedisClient();
	if (client == null) {
		logger.warn('Cannot blacklist token — Redis unavailable');
		return;
	}

	try {
		const decoded = jwt.decode(token) as { exp?: number } | null;
		const now = Math.floor(Date.now() / 1000);
		const ttl =
			decoded?.exp != null && decoded.exp > now
				? decoded.exp - now
				: 86_400;

		await client.setEx(`${BLACKLIST_NAMESPACE}:${token}`, ttl, '1');
		logger.debug({ ttl }, 'Token blacklisted');
	} catch (err) {
		logger.error({ err }, 'Failed to blacklist token');
	}
}

/**
 * Check if a token has been revoked.
 *
 * @param token - The raw JWT string to check.
 * @returns `true` if the token is blacklisted (should be rejected).
 *
 * @remarks
 * Called by the auth middleware on every authenticated request.
 * Returns `false` if Redis is unavailable (fail-open).
 *
 * @example
 * ```ts
 * if (await isTokenBlacklisted(token)) {
 *   throw new UnauthorizedError('Token has been revoked');
 * }
 * ```
 */
export async function isTokenBlacklisted(token: string): Promise<boolean> {
	const client = getRedisClient();
	if (client == null) return false;

	try {
		const result = await client.exists(`${BLACKLIST_NAMESPACE}:${token}`);
		return result === 1;
	} catch (err) {
		logger.warn({ err }, 'Token blacklist check failed — allowing request');
		return false;
	}
}

/**
 * Blacklist all tokens for a specific user by storing a "revoked-before"
 * timestamp. Any token issued before this timestamp is considered invalid.
 *
 * @param userId    - The user whose tokens should be invalidated.
 * @param ttlSeconds - How long to remember this revocation (default: 7 days,
 *                     matching the refresh token lifetime).
 *
 * @remarks
 * This is more efficient than blacklisting individual tokens when a user
 * changes their password or is deactivated. The auth middleware checks
 * the token's `iat` against this timestamp.
 *
 * @example
 * ```ts
 * await revokeAllUserTokens(userId); // on password change
 * ```
 */
export async function revokeAllUserTokens(
	userId: string,
	ttlSeconds = 604_800,
): Promise<void> {
	const client = getRedisClient();
	if (client == null) return;

	try {
		const revokedAt = Math.floor(Date.now() / 1000);
		await client.setEx(`token:revoked-before:${userId}`, ttlSeconds, String(revokedAt));
		logger.info({ userId }, 'All tokens revoked for user');
	} catch (err) {
		logger.error({ err, userId }, 'Failed to revoke user tokens');
	}
}

/**
 * Check if a token was issued before the user's "revoked-before" timestamp.
 *
 * @param userId - The user ID from the token's `sub` claim.
 * @param iat    - The token's `iat` (issued-at) claim as a Unix timestamp.
 * @returns `true` if the token was issued before the revocation cutoff.
 */
export async function isTokenRevokedForUser(
	userId: string,
	iat: number | undefined,
): Promise<boolean> {
	const client = getRedisClient();
	if (client == null) return false;

	if (iat == null) return false;

	try {
		const revokedBefore = await client.get(`token:revoked-before:${userId}`);
		if (revokedBefore == null) return false;
		return iat < Number(revokedBefore);
	} catch (err) {
		logger.warn({ err, userId }, 'User token revocation check failed');
		return false;
	}
}
