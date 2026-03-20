import { cacheService } from '../../../infrastructure/redis/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import type { IPaginationMeta } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/index.js';
import type { IUser } from '../model/index.js';
import { buildActiveUsersFilter, buildUserListFilter } from '../queries/index.js';
import { UserRepository } from '../repository/index.js';
import type { UpdateUserDto } from '../validation/index.js';

/**
 * Cache configuration constants.
 *
 * @remarks
 * TTLs are intentionally short for user data — stale user profiles
 * cause worse UX than a cache miss. Analytics data is cached longer
 * because it's computationally expensive and changes slowly.
 */
const CACHE_NAMESPACE = 'user' as const;
const CACHE_TTL_SECONDS = 300; // 5 minutes for individual user profiles
const CACHE_TTL_LIST_SECONDS = 60; // 1 minute for paginated lists
const CACHE_TTL_ANALYTICS_SECONDS = 900; // 15 minutes for aggregation results

/**
 * User Domain Service — pure business logic with Redis cache integration.
 *
 * @module modules/user/service/user.service
 *
 * @description
 * The service layer encapsulates domain rules without any knowledge of
 * Express, HTTP, or request/response objects. This makes it reusable
 * across transport layers (HTTP, WebSocket, CLI, gRPC).
 *
 * ### Caching strategy (Cache-Aside / Lazy Loading):
 *
 * ```
 * Client → Service.getUserById()
 *   ├── Cache HIT  → return cached value (fast path)
 *   └── Cache MISS → Repository.findById() → set cache → return
 * ```
 *
 * Cache invalidation happens on:
 * - `updateUser()` — invalidates the specific user key.
 * - `deactivateUser()` — invalidates user key + user list pattern.
 *
 * ### Why Cache-Aside over Write-Through:
 * - Simpler to reason about — no dual-write consistency issues.
 * - Naturally handles cache misses (cold start, evictions).
 * - The write path (updates, deletes) explicitly invalidates.
 */
export class UserService {
	constructor(private readonly userRepository: UserRepository) {}

	/**
	 * Get a single user by ID.
	 *
	 * @param id - MongoDB ObjectId string.
	 * @returns The user object.
	 * @throws {@link NotFoundError} if the user does not exist.
	 *
	 * @remarks
	 * Uses cache-aside pattern: check Redis first, fall through to MongoDB.
	 */
	async getUserById(id: string): Promise<IUser> {
		const cached = await cacheService.get<IUser>(CACHE_NAMESPACE, id);
		if (cached != null) {
			logger.debug({ userId: id }, 'User cache HIT');
			return cached;
		}

		const user = await this.userRepository.findById(id);
		if (user == null) {
			throw new NotFoundError('User not found');
		}

		await cacheService.set(CACHE_NAMESPACE, id, user, CACHE_TTL_SECONDS);
		return user;
	}

	/**
	 * Get a paginated list of users.
	 *
	 * @param page  - 1-indexed page number.
	 * @param limit - Results per page.
	 * @param role  - Optional role filter.
	 * @returns Paginated user list with metadata.
	 *
	 * @remarks
	 * List results are cached with a short TTL since they change frequently.
	 * The cache key encodes the pagination params for uniqueness.
	 */
	async getUsers(
		page: number,
		limit: number,
		role?: 'user' | 'admin',
	): Promise<{ users: IUser[]; meta: IPaginationMeta }> {
		const cacheKey = `list:${String(page)}:${String(limit)}:${role ?? 'all'}`;
		const cached = await cacheService.get<{ users: IUser[]; meta: IPaginationMeta }>(
			CACHE_NAMESPACE,
			cacheKey,
		);
		if (cached != null) {
			return cached;
		}

		const filter = role != null
			? buildUserListFilter({ role })
			: buildActiveUsersFilter();

		const result = await this.userRepository.findPaginated(filter, page, limit);
		await cacheService.set(CACHE_NAMESPACE, cacheKey, result, CACHE_TTL_LIST_SECONDS);
		return result;
	}

	/**
	 * Update user profile fields.
	 *
	 * @param id   - User ObjectId string.
	 * @param data - Validated update payload.
	 * @returns The updated user object.
	 * @throws {@link NotFoundError} if the user does not exist.
	 *
	 * @remarks
	 * After a successful update, the individual user cache AND the list
	 * cache pattern are invalidated to prevent stale reads.
	 */
	async updateUser(id: string, data: UpdateUserDto): Promise<IUser> {
		const updateData: { firstName?: string; lastName?: string } = {};
		if (data.firstName !== undefined) updateData.firstName = data.firstName;
		if (data.lastName !== undefined) updateData.lastName = data.lastName;

		const user = await this.userRepository.updateById(id, updateData);
		if (user == null) {
			throw new NotFoundError('User not found');
		}

		await Promise.all([
			cacheService.invalidate(CACHE_NAMESPACE, id),
			cacheService.invalidatePattern(`${CACHE_NAMESPACE}:list`),
		]);

		return user;
	}

	/**
	 * Soft-delete (deactivate) a user account.
	 *
	 * @param id - User ObjectId string.
	 * @throws {@link NotFoundError} if the user does not exist.
	 *
	 * @remarks
	 * Deactivation triggers full cache invalidation for the user namespace
	 * because it affects list queries, analytics, and the individual profile.
	 */
	async deactivateUser(id: string): Promise<void> {
		const user = await this.userRepository.softDelete(id);
		if (user == null) {
			throw new NotFoundError('User not found');
		}

		await cacheService.invalidatePattern(CACHE_NAMESPACE);
	}

	/**
	 * Get monthly active user retention statistics.
	 *
	 * @param startDate - Analysis window start.
	 * @param endDate   - Analysis window end.
	 * @returns Per-month retention statistics.
	 *
	 * @remarks
	 * Analytics results are cached with a longer TTL (15 min) because
	 * the aggregation pipeline is expensive and the data changes slowly.
	 * The cache key includes the date range for uniqueness.
	 */
	async getRetentionStats(
		startDate: Date,
		endDate: Date,
	): ReturnType<UserRepository['getMonthlyRetentionStats']> {
		const cacheKey = `analytics:retention:${startDate.toISOString()}:${endDate.toISOString()}`;
		const cached = await cacheService.get<
			Awaited<ReturnType<UserRepository['getMonthlyRetentionStats']>>
		>(CACHE_NAMESPACE, cacheKey);
		if (cached != null) {
			return cached;
		}

		const stats = await this.userRepository.getMonthlyRetentionStats(startDate, endDate);
		await cacheService.set(CACHE_NAMESPACE, cacheKey, stats, CACHE_TTL_ANALYTICS_SECONDS);
		return stats;
	}

	/**
	 * Get user count grouped by role.
	 *
	 * @returns Array of `{ role, count }` objects.
	 */
	async getRoleDistribution(): Promise<Array<{ role: string; count: number }>> {
		const cacheKey = 'analytics:role-distribution';
		const cached = await cacheService.get<Array<{ role: string; count: number }>>(
			CACHE_NAMESPACE,
			cacheKey,
		);
		if (cached != null) return cached;

		const stats = await this.userRepository.getRoleDistribution();
		await cacheService.set(CACHE_NAMESPACE, cacheKey, stats, CACHE_TTL_ANALYTICS_SECONDS);
		return stats;
	}

	/**
	 * Get user registration trends over time.
	 *
	 * @param startDate   - Window start.
	 * @param endDate     - Window end.
	 * @param granularity - Time bucket size ('day', 'week', 'month').
	 * @returns Registration trend data.
	 */
	async getRegistrationTrends(
		startDate: Date,
		endDate: Date,
		granularity: 'day' | 'week' | 'month' = 'month',
	): ReturnType<UserRepository['getRegistrationTrends']> {
		const cacheKey = `analytics:trends:${granularity}:${startDate.toISOString()}:${endDate.toISOString()}`;
		const cached = await cacheService.get<
			Awaited<ReturnType<UserRepository['getRegistrationTrends']>>
		>(CACHE_NAMESPACE, cacheKey);
		if (cached != null) return cached;

		const trends = await this.userRepository.getRegistrationTrends(
			startDate,
			endDate,
			granularity,
		);
		await cacheService.set(CACHE_NAMESPACE, cacheKey, trends, CACHE_TTL_ANALYTICS_SECONDS);
		return trends;
	}
}
