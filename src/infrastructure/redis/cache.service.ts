import { logger } from '../../shared/utils/logger.js';

import { getRedisClient } from './redis.client.js';

/**
 * Cache Service — generic Redis-backed cache abstraction.
 *
 * @module infrastructure/redis/cache.service
 *
 * @description
 * Provides a type-safe, domain-agnostic caching API on top of Redis.
 * Every method is **fail-safe** — if Redis is down, operations return
 * `null` / `false` and the caller falls through to the primary data source.
 *
 * ### Design decisions:
 * - **Namespace-based keys**: Every key is prefixed with a namespace
 *   (e.g., `user:123`, `session:abc`) to prevent collisions and enable
 *   targeted invalidation via `invalidatePattern()`.
 * - **TTL-mandatory**: Every `set()` call requires an explicit TTL to
 *   prevent unbounded memory growth. No "set and forget forever."
 * - **JSON serialization**: All values are stored as JSON strings.
 *   Binary/Buffer caching is out of scope for this service.
 *
 * ### Usage pattern (in a service):
 * ```ts
 * const cached = await cacheService.get<IUser>('user', userId);
 * if (cached != null) return cached;
 *
 * const user = await this.userRepository.findById(userId);
 * await cacheService.set('user', userId, user, 300); // 5 min TTL
 * return user;
 * ```
 */
export class CacheService {
	/**
	 * Build a namespaced Redis key.
	 *
	 * @param namespace - Domain prefix (e.g., 'user', 'session', 'config').
	 * @param key       - Unique identifier within the namespace.
	 * @returns Fully-qualified key like `user:507f1f77bcf86cd799439011`.
	 */
	private buildKey(namespace: string, key: string): string {
		return `${namespace}:${key}`;
	}

	/**
	 * Retrieve a cached value by namespace + key.
	 *
	 * @typeParam T - The expected shape of the cached object.
	 * @param namespace - Domain prefix.
	 * @param key       - Unique identifier.
	 * @returns The parsed object, or `null` on cache miss / Redis unavailable.
	 *
	 * @example
	 * ```ts
	 * const user = await cache.get<IUser>('user', '507f1f77bcf86cd799439011');
	 * ```
	 */
	async get<T>(namespace: string, key: string): Promise<T | null> {
		const client = getRedisClient();
		if (client == null) return null;

		try {
			const data = await client.get(this.buildKey(namespace, key));
			if (data == null) return null;
			return JSON.parse(data) as T;
		} catch (err) {
			logger.warn({ err, namespace, key }, 'Cache GET failed');
			return null;
		}
	}

	/**
	 * Store a value in cache with a mandatory TTL.
	 *
	 * @param namespace  - Domain prefix.
	 * @param key        - Unique identifier.
	 * @param value      - Object to cache (will be JSON-serialized).
	 * @param ttlSeconds - Time-to-live in seconds. REQUIRED to prevent unbounded growth.
	 *
	 * @example
	 * ```ts
	 * await cache.set('user', userId, userObject, 600); // 10 minutes
	 * ```
	 */
	async set(namespace: string, key: string, value: unknown, ttlSeconds: number): Promise<void> {
		const client = getRedisClient();
		if (client == null) return;

		try {
			await client.setEx(this.buildKey(namespace, key), ttlSeconds, JSON.stringify(value));
		} catch (err) {
			logger.warn({ err, namespace, key }, 'Cache SET failed');
		}
	}

	/**
	 * Delete a specific cached entry.
	 *
	 * @param namespace - Domain prefix.
	 * @param key       - Unique identifier.
	 * @returns `true` if the key existed and was deleted, `false` otherwise.
	 *
	 * @example
	 * ```ts
	 * await cache.invalidate('user', userId); // after user update
	 * ```
	 */
	async invalidate(namespace: string, key: string): Promise<boolean> {
		const client = getRedisClient();
		if (client == null) return false;

		try {
			const deleted = await client.del(this.buildKey(namespace, key));
			return deleted > 0;
		} catch (err) {
			logger.warn({ err, namespace, key }, 'Cache INVALIDATE failed');
			return false;
		}
	}

	/**
	 * Bulk-invalidate all keys matching a namespace pattern.
	 *
	 * Uses Redis `SCAN` (non-blocking) instead of `KEYS` (which blocks
	 * the Redis event loop on large datasets).
	 *
	 * @param namespace - Domain prefix. All keys starting with `namespace:*` are deleted.
	 * @returns Number of keys deleted.
	 *
	 * @example
	 * ```ts
	 * await cache.invalidatePattern('user'); // clear all user caches
	 * ```
	 */
	async invalidatePattern(namespace: string): Promise<number> {
		const client = getRedisClient();
		if (client == null) return 0;

		try {
			const pattern = `${namespace}:*`;
			let cursor = 0;
			let totalDeleted = 0;

			do {
				const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
				cursor = result.cursor;

				if (result.keys.length > 0) {
					const deleted = await client.del(result.keys);
					totalDeleted += deleted;
				}
			} while (cursor !== 0);

			if (totalDeleted > 0) {
				logger.debug({ namespace, totalDeleted }, 'Cache pattern invalidated');
			}
			return totalDeleted;
		} catch (err) {
			logger.warn({ err, namespace }, 'Cache INVALIDATE_PATTERN failed');
			return 0;
		}
	}

	/**
	 * Check if a key exists in cache without retrieving its value.
	 *
	 * @param namespace - Domain prefix.
	 * @param key       - Unique identifier.
	 * @returns `true` if the key exists, `false` otherwise.
	 */
	async exists(namespace: string, key: string): Promise<boolean> {
		const client = getRedisClient();
		if (client == null) return false;

		try {
			const result = await client.exists(this.buildKey(namespace, key));
			return result === 1;
		} catch (err) {
			logger.warn({ err, namespace, key }, 'Cache EXISTS failed');
			return false;
		}
	}

	/**
	 * Set a key only if it does NOT already exist (atomic).
	 * Useful for distributed locks and idempotency keys.
	 *
	 * @param namespace  - Domain prefix.
	 * @param key        - Unique identifier.
	 * @param value      - Value to store.
	 * @param ttlSeconds - TTL in seconds.
	 * @returns `true` if the key was set (did not exist), `false` if it already existed.
	 */
	async setIfNotExists(
		namespace: string,
		key: string,
		value: unknown,
		ttlSeconds: number,
	): Promise<boolean> {
		const client = getRedisClient();
		if (client == null) return false;

		try {
			const result = await client.set(this.buildKey(namespace, key), JSON.stringify(value), {
				EX: ttlSeconds,
				NX: true,
			});
			return result === 'OK';
		} catch (err) {
			logger.warn({ err, namespace, key }, 'Cache SET_NX failed');
			return false;
		}
	}
}

/**
 * Shared singleton instance — import this in services.
 *
 * @example
 * ```ts
 * import { cacheService } from '@/infrastructure/redis/cache.service.js';
 *
 * const user = await cacheService.get<IUser>('user', id);
 * ```
 */
export const cacheService = new CacheService();
