import type { FilterQuery, Types } from 'mongoose';

import type { IPaginationMeta } from '../../../shared/types/index.js';
import type { IUser, IUserDocument } from '../model/index.js';
import { UserModel } from '../model/index.js';
import {
	DEFAULT_USER_SORT,
	SAFE_USER_PROJECTION,
	buildEmailLookupFilter,
	buildRetentionPipeline,
	buildRoleDistributionPipeline,
	buildRegistrationTrendPipeline,
} from '../queries/index.js';

/**
 * User Repository — Data Access Layer.
 *
 * @module modules/user/repository/user.repository
 *
 * @description
 * The repository encapsulates ALL database interactions for the User
 * aggregate. Services never import Mongoose models directly — they call
 * repository methods.
 *
 * ### Stored Procedure pattern:
 * This repository does NOT define queries inline. All filters,
 * projections, sort orders, and aggregation pipelines are imported from
 * the **Query Store** (`../queries/user.queries.ts`). The repository's
 * role is to:
 * 1. Call the appropriate query builder with the right parameters.
 * 2. Execute the query via Mongoose.
 * 3. Return typed results.
 *
 * This separation mirrors SQL stored procedures: the repository is the
 * "executor" and the query store is the "procedure definition."
 *
 * ### Performance conventions:
 * - `.lean()` on every read query (~3x faster than hydrated documents).
 * - Projections via `SAFE_USER_PROJECTION` to exclude `password` and `__v`.
 * - Parallel `Promise.all()` for paginated queries (data + count).
 *
 * ### Why the repository is a class:
 * Classes allow constructor-based dependency injection (e.g., injecting
 * a mock Mongoose model in tests) and provide a clear boundary for
 * mocking in unit tests.
 */
export class UserRepository {
	/**
	 * Create a new user document.
	 *
	 * @param data - Fields required to create a user (email, password, names).
	 * @returns The created Mongoose document (password excluded via toJSON transform).
	 *
	 * @remarks
	 * Uses Mongoose `create()` which runs validators and middleware.
	 * The returned document is NOT lean — it's a full Mongoose doc
	 * so the caller can access `.id`, `.toJSON()`, etc.
	 */
	async create(
		data: Pick<IUser, 'email' | 'password' | 'firstName' | 'lastName'>,
	): Promise<IUserDocument> {
		return UserModel.create(data);
	}

	/**
	 * Find a single user by ID.
	 *
	 * @param id - MongoDB ObjectId (string or ObjectId type).
	 * @returns Lean POJO user object, or `null` if not found.
	 *
	 * @remarks
	 * Uses `SAFE_USER_PROJECTION` from the query store.
	 * `.lean()` returns a plain object — ~3x faster than a Mongoose doc.
	 */
	async findById(id: string | Types.ObjectId): Promise<IUser | null> {
		return UserModel.findById(id, SAFE_USER_PROJECTION).lean<IUser>().exec();
	}

	/**
	 * Find a user by email with password hash included.
	 *
	 * @param email - The email to look up.
	 * @returns Full Mongoose document (with password) for auth verification.
	 *
	 * @remarks
	 * This is the ONLY method that returns the password field.
	 * Uses `buildEmailLookupFilter()` from the query store which
	 * filters by `{ email, isActive: true }`.
	 */
	async findByEmailWithPassword(email: string): Promise<IUserDocument | null> {
		return UserModel.findOne(buildEmailLookupFilter(email))
			.select('+password')
			.exec();
	}

	/**
	 * Check if an active user with the given email exists.
	 *
	 * @param email - The email to check.
	 * @returns `true` if an active user with this email exists.
	 *
	 * @remarks
	 * Uses `countDocuments()` rather than `findOne()` — avoids transferring
	 * document data when only existence matters. Leverages the partial
	 * unique index on `{ email, isActive: true }`.
	 */
	async existsByEmail(email: string): Promise<boolean> {
		const count = await UserModel.countDocuments(buildEmailLookupFilter(email)).exec();
		return count > 0;
	}

	/**
	 * Paginated user listing.
	 *
	 * @param filter - MongoDB filter query (typically from `buildUserListFilter()`).
	 * @param page   - 1-indexed page number.
	 * @param limit  - Results per page.
	 * @returns Object containing the user array and pagination metadata.
	 *
	 * @remarks
	 * Runs the data query and count query in parallel via `Promise.all()`
	 * for optimal performance. Uses `DEFAULT_USER_SORT` from the query store.
	 */
	async findPaginated(
		filter: FilterQuery<IUserDocument>,
		page: number,
		limit: number,
	): Promise<{ users: IUser[]; meta: IPaginationMeta }> {
		const skip = (page - 1) * limit;

		const [users, totalDocs] = await Promise.all([
			UserModel.find(filter, SAFE_USER_PROJECTION)
				.sort(DEFAULT_USER_SORT)
				.skip(skip)
				.limit(limit)
				.lean<IUser[]>()
				.exec(),
			UserModel.countDocuments(filter).exec(),
		]);

		const totalPages = Math.ceil(totalDocs / limit);

		return {
			users,
			meta: {
				page,
				limit,
				totalDocs,
				totalPages,
				hasNextPage: page < totalPages,
				hasPrevPage: page > 1,
			},
		};
	}

	/**
	 * Update specific user fields by ID.
	 *
	 * @param id   - User ObjectId.
	 * @param data - Partial update payload.
	 * @returns Updated lean user, or `null` if not found.
	 *
	 * @remarks
	 * Uses `$set` to prevent accidental full-document overwrites.
	 * `runValidators: true` ensures Mongoose schema validators run on updates.
	 */
	async updateById(
		id: string | Types.ObjectId,
		data: Partial<Pick<IUser, 'firstName' | 'lastName' | 'lastLoginAt' | 'isActive'>>,
	): Promise<IUser | null> {
		return UserModel.findByIdAndUpdate(
			id,
			{ $set: data },
			{ new: true, runValidators: true },
		)
			.select(SAFE_USER_PROJECTION)
			.lean<IUser>()
			.exec();
	}

	/**
	 * Soft-delete — deactivate a user without destroying the document.
	 *
	 * @param id - User ObjectId.
	 * @returns Updated lean user, or `null` if not found.
	 *
	 * @remarks
	 * Sets `isActive: false`. The partial unique index on email releases
	 * the email for re-registration by a new account.
	 */
	async softDelete(id: string | Types.ObjectId): Promise<IUser | null> {
		return this.updateById(id, { isActive: false });
	}

	/* ═══════════════════════════════════════════════════════════════════
	 * AGGREGATION PIPELINE EXECUTORS
	 *
	 * Pipeline definitions live in the Query Store (user.queries.ts).
	 * The repository merely executes them.
	 * ═══════════════════════════════════════════════════════════════════ */

	/**
	 * Execute the Monthly Active User Retention pipeline.
	 *
	 * @param startDate - Analysis window start.
	 * @param endDate   - Analysis window end.
	 * @returns Per-month retention statistics.
	 *
	 * @see {@link buildRetentionPipeline} in `user.queries.ts` for the
	 * pipeline definition, stage-by-stage documentation, and index requirements.
	 */
	async getMonthlyRetentionStats(
		startDate: Date,
		endDate: Date,
	): Promise<
		Array<{
			month: string;
			year: number;
			monthNum: number;
			totalActiveUsers: number;
			newRegistrations: number;
			usersWithSessions: number;
			retentionRate: number;
		}>
	> {
		const pipeline = buildRetentionPipeline(startDate, endDate);
		return UserModel.aggregate(pipeline).exec();
	}

	/**
	 * Execute the Role Distribution pipeline.
	 *
	 * @returns Array of `{ role, count }` objects.
	 *
	 * @see {@link buildRoleDistributionPipeline} in `user.queries.ts`.
	 */
	async getRoleDistribution(): Promise<Array<{ role: string; count: number }>> {
		const pipeline = buildRoleDistributionPipeline();
		return UserModel.aggregate(pipeline).exec();
	}

	/**
	 * Execute the Registration Trend pipeline.
	 *
	 * @param startDate   - Window start.
	 * @param endDate     - Window end.
	 * @param granularity - Time bucket size.
	 * @returns Array of registration counts per time period.
	 *
	 * @see {@link buildRegistrationTrendPipeline} in `user.queries.ts`.
	 */
	async getRegistrationTrends(
		startDate: Date,
		endDate: Date,
		granularity: 'day' | 'week' | 'month' = 'month',
	): Promise<
		Array<{
			period: Record<string, number>;
			registrations: number;
			activeRegistrations: number;
			churnedRegistrations: number;
		}>
	> {
		const pipeline = buildRegistrationTrendPipeline(startDate, endDate, granularity);
		return UserModel.aggregate(pipeline).exec();
	}
}
