import { createClient, type RedisClientType } from 'redis';

import { env } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Redis Client Singleton
 *
 * @module infrastructure/redis/redis.client
 *
 * @description
 * Provides a single, reusable Redis connection shared across the entire
 * process. The singleton pattern is mandatory here — opening multiple
 * connections per request would exhaust the Redis connection pool.
 *
 * ### Why Redis is a first-class dependency:
 * 1. **Caching** — Hot-path DB reads are cached (user profiles, config).
 * 2. **Session / Token Blacklist** — Revoked JWTs are stored with a TTL
 *    matching the token's remaining lifetime (logout, password change).
 * 3. **Rate Limiting** — `express-rate-limit` can use a Redis store for
 *    distributed rate limiting across multiple processes.
 * 4. **Socket.io Adapter** — Horizontal scaling of WebSocket events.
 * 5. **Pub/Sub** — Cross-process event broadcasting.
 *
 * ### Connection lifecycle:
 * - `connectRedis()` — called once during server bootstrap.
 * - `disconnectRedis()` — called during graceful shutdown (SIGINT/SIGTERM).
 * - `getRedisClient()` — returns the connected client for use in services.
 *
 * ### Error handling:
 * Redis is treated as **non-critical** — if it's unavailable, the app
 * continues without caching (cache misses fall through to MongoDB).
 * This is logged as a warning, not a fatal error.
 */

let client: RedisClientType | null = null;
let isConnected = false;

/**
 * Establish the Redis connection.
 *
 * @returns The connected Redis client, or `null` if `REDIS_URL` is not configured.
 *
 * @example
 * ```ts
 * // Called once in server.ts bootstrap
 * await connectRedis();
 * ```
 */
export async function connectRedis(): Promise<RedisClientType | null> {
	if (env.REDIS_URL == null) {
		logger.info('REDIS_URL not set — Redis disabled, caching will be skipped');
		return null;
	}

	try {
		client = createClient({
			url: env.REDIS_URL,
			socket: {
				reconnectStrategy(retries: number) {
					if (retries > 10) {
						logger.error('Redis max reconnection attempts reached');
						return new Error('Redis max reconnection attempts reached');
					}
					return Math.min(retries * 200, 5000);
				},
				connectTimeout: 10_000,
			},
		});

		client.on('connect', () => {
			logger.info('Redis client connecting...');
		});

		client.on('ready', () => {
			isConnected = true;
			logger.info('Redis client ready');
		});

		client.on('error', (err) => {
			isConnected = false;
			logger.error({ err }, 'Redis client error');
		});

		client.on('end', () => {
			isConnected = false;
			logger.warn('Redis client disconnected');
		});

		await client.connect();
		return client;
	} catch (err) {
		logger.warn({ err }, 'Failed to connect to Redis — continuing without cache');
		client = null;
		return null;
	}
}

/**
 * Gracefully close the Redis connection.
 * Called during SIGINT/SIGTERM shutdown sequence.
 */
export async function disconnectRedis(): Promise<void> {
	if (client != null && isConnected) {
		await client.quit();
		logger.info('Redis connection closed gracefully');
	}
}

/**
 * Retrieve the active Redis client instance.
 *
 * @returns The connected client, or `null` if Redis is disabled/unavailable.
 *
 * @remarks
 * Callers MUST null-check the return value. A `null` client means
 * "Redis is offline — skip caching and go directly to the data source."
 */
export function getRedisClient(): RedisClientType | null {
	if (client == null || !isConnected) {
		return null;
	}
	return client;
}

/**
 * Check whether the Redis connection is currently active.
 *
 * @returns `true` if Redis is connected and responsive.
 */
export function isRedisConnected(): boolean {
	return isConnected;
}
