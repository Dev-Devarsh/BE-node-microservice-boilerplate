import type { FilterQuery, PipelineStage } from 'mongoose';

import type { IUserDocument } from '../model/index.js';

/**
 * User Query Store — "Stored Procedures" for MongoDB.
 *
 * @module modules/user/queries/user.queries
 *
 * @description
 * This file is the **single source of truth** for every MongoDB query,
 * filter, projection, and aggregation pipeline used by the User domain.
 *
 * ### Why this pattern exists (Stored Procedure analogy):
 *
 * In relational databases, stored procedures keep SQL out of application
 * code. They are versioned, optimized, and security-audited independently.
 * This query store provides the same benefits for MongoDB:
 *
 * 1. **Separation of concerns** — The repository decides *when* to run a
 *    query; this file decides *what* the query looks like. A DBA or data
 *    engineer can review/optimize queries without touching business logic.
 *
 * 2. **Reusability** — The same pipeline stage (e.g., `SAFE_PROJECTION`)
 *    is defined once and referenced everywhere, preventing drift.
 *
 * 3. **Testability** — Query builders are pure functions. They can be
 *    unit-tested by asserting the generated pipeline stages without
 *    needing a real MongoDB connection.
 *
 * 4. **Auditability** — All database interactions are in one place per
 *    domain, making security reviews straightforward.
 *
 * 5. **Index alignment** — Query shapes are co-located, making it easy
 *    to verify that every query has a supporting index.
 *
 * ### Naming convention:
 * - `build*Filter()` — returns a `FilterQuery` for `.find()` / `.countDocuments()`.
 * - `build*Pipeline()` — returns a `PipelineStage[]` for `.aggregate()`.
 * - `*_PROJECTION` — constant objects for `.select()` / `$project`.
 * - `*_SORT` — constant objects for `.sort()`.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * PROJECTIONS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Safe read projection — strips sensitive/internal fields from query results.
 *
 * Used on every public-facing read query to prevent accidental password
 * or internal metadata leakage.
 *
 * @remarks Maps to MongoDB projection: `{ password: 0, __v: 0 }`.
 */
export const SAFE_USER_PROJECTION = { password: 0, __v: 0 } as const;

/**
 * Projection for auth flows where the password hash IS needed.
 * Only used by `findByEmail` during login.
 */
export const AUTH_PROJECTION = '+password' as const;

/* ═══════════════════════════════════════════════════════════════════════
 * SORT ORDERS
 * ═══════════════════════════════════════════════════════════════════════ */

/** Default sort: newest users first. Leverages the `{ role, createdAt }` compound index. */
export const DEFAULT_USER_SORT = { createdAt: -1 } as const;

/** Admin dashboard sort: by role then by registration date. */
export const ADMIN_DASHBOARD_SORT = { role: 1, createdAt: -1 } as const;

/* ═══════════════════════════════════════════════════════════════════════
 * FILTER BUILDERS
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Build a filter for active users.
 *
 * @remarks
 * This leverages the partial index `{ email: 1, unique: true, where: isActive }`.
 *
 * @example
 * ```ts
 * const filter = buildActiveUsersFilter();
 * // { isActive: true }
 * ```
 */
export function buildActiveUsersFilter(): FilterQuery<IUserDocument> {
	return { isActive: true };
}

/**
 * Build a filter for finding a user by email (active only).
 *
 * @param email - The email address to search for.
 * @returns Filter document leveraging the email single-field index.
 *
 * @example
 * ```ts
 * const filter = buildEmailLookupFilter('john@example.com');
 * // { email: 'john@example.com', isActive: true }
 * ```
 */
export function buildEmailLookupFilter(email: string): FilterQuery<IUserDocument> {
	return { email, isActive: true };
}

/**
 * Build a filter for paginated user listing with optional role filtering.
 *
 * @param options - Optional filter criteria.
 * @param options.role     - Filter by user role ('user' | 'admin').
 * @param options.isActive - Filter by active status (defaults to `true`).
 * @returns Filter document. When `role` is provided, this leverages the
 *          `{ role, createdAt }` compound index.
 *
 * @example
 * ```ts
 * const filter = buildUserListFilter({ role: 'admin' });
 * // { isActive: true, role: 'admin' }
 * ```
 */
export function buildUserListFilter(
	options: {
		role?: 'user' | 'admin';
		isActive?: boolean;
	} = {},
): FilterQuery<IUserDocument> {
	const filter: Record<string, unknown> = {
		isActive: options.isActive ?? true,
	};

	if (options.role != null) {
		filter['role'] = options.role;
	}

	return filter as FilterQuery<IUserDocument>;
}

/* ═══════════════════════════════════════════════════════════════════════
 * AGGREGATION PIPELINES
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Build the Monthly Active User (MAU) Retention aggregation pipeline.
 *
 * @param startDate - Beginning of the analysis window.
 * @param endDate   - End of the analysis window.
 * @returns A `PipelineStage[]` ready to pass to `UserModel.aggregate()`.
 *
 * ### Pipeline breakdown:
 *
 * | Stage     | Purpose                                                  | Index used                        |
 * |-----------|----------------------------------------------------------|-----------------------------------|
 * | `$match`  | Filter active users created before `endDate`             | `{ isActive, createdAt }` partial |
 * | `$project`| Drop unnecessary fields early to reduce pipeline memory  | —                                 |
 * | `$lookup` | Join with `sessions` collection for activity data        | `sessions.{ userId, createdAt }`  |
 * | `$unwind` | Flatten session data for per-month grouping              | —                                 |
 * | `$group`  | Bucket by year-month, count MAU / new registrations      | —                                 |
 * | `$addFields` | Calculate retention rate as a percentage              | —                                 |
 * | `$project`| Final shape with human-readable month names              | —                                 |
 * | `$sort`   | Chronological order                                      | —                                 |
 *
 * ### Optimization notes:
 * - `$match` is FIRST so MongoDB can use indexes to narrow the working set.
 * - `$project` is SECOND to drop fields like `password`, `firstName`, etc.
 *   before the expensive `$lookup`.
 * - The `$lookup` uses a sub-pipeline (not the legacy array syntax) for
 *   server-side filtering — only matching sessions are transferred.
 * - `$group` uses `$ifNull` to handle users with zero sessions gracefully.
 *
 * @example
 * ```ts
 * const pipeline = buildRetentionPipeline(
 *   new Date('2025-01-01'),
 *   new Date('2025-12-31'),
 * );
 * const stats = await UserModel.aggregate(pipeline);
 * ```
 */
export function buildRetentionPipeline(
	startDate: Date,
	endDate: Date,
): PipelineStage[] {
	return [
		/* Stage 1: Filter — uses { isActive, createdAt } index */
		{
			$match: {
				isActive: true,
				createdAt: { $lte: endDate },
			},
		},

		/* Stage 2: Project — drop heavyweight fields before $lookup */
		{
			$project: {
				_id: 1,
				email: 1,
				createdAt: 1,
				lastLoginAt: 1,
				registrationMonth: { $month: '$createdAt' },
				registrationYear: { $year: '$createdAt' },
			},
		},

		/* Stage 3: Lookup — correlated sub-pipeline into sessions */
		{
			$lookup: {
				from: 'sessions',
				let: { userId: '$_id' },
				pipeline: [
					{
						$match: {
							$expr: {
								$and: [
									{ $eq: ['$userId', '$$userId'] },
									{ $gte: ['$createdAt', startDate] },
									{ $lte: ['$createdAt', endDate] },
								],
							},
						},
					},
					{
						$group: {
							_id: {
								month: { $month: '$createdAt' },
								year: { $year: '$createdAt' },
							},
						},
					},
				],
				as: 'activeSessions',
			},
		},

		/* Stage 4: Unwind — flatten sessions (preserve users with no sessions) */
		{ $unwind: { path: '$activeSessions', preserveNullAndEmptyArrays: true } },

		/* Stage 5: Group — bucket by month/year */
		{
			$group: {
				_id: {
					month: {
						$ifNull: ['$activeSessions._id.month', '$registrationMonth'],
					},
					year: {
						$ifNull: ['$activeSessions._id.year', '$registrationYear'],
					},
				},
				totalActiveUsers: { $sum: 1 },
				newRegistrations: {
					$sum: {
						$cond: [
							{
								$and: [
									{ $eq: ['$registrationMonth', '$activeSessions._id.month'] },
									{ $eq: ['$registrationYear', '$activeSessions._id.year'] },
								],
							},
							1,
							0,
						],
					},
				},
				usersWithSessions: {
					$sum: {
						$cond: [
							{ $gt: [{ $size: { $ifNull: ['$activeSessions', []] } }, 0] },
							1,
							0,
						],
					},
				},
			},
		},

		/* Stage 6: Compute retention percentage */
		{
			$addFields: {
				retentionRate: {
					$cond: [
						{ $gt: ['$totalActiveUsers', 0] },
						{
							$round: [
								{
									$multiply: [
										{ $divide: ['$usersWithSessions', '$totalActiveUsers'] },
										100,
									],
								},
								2,
							],
						},
						0,
					],
				},
			},
		},

		/* Stage 7: Final projection with readable month names */
		{
			$project: {
				_id: 0,
				year: '$_id.year',
				monthNum: '$_id.month',
				month: {
					$arrayElemAt: [
						[
							'',
							'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
							'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
						],
						'$_id.month',
					],
				},
				totalActiveUsers: 1,
				newRegistrations: 1,
				usersWithSessions: 1,
				retentionRate: 1,
			},
		},

		/* Stage 8: Sort chronologically */
		{ $sort: { year: 1, monthNum: 1 } },
	];
}

/**
 * Build a pipeline to count users grouped by role.
 *
 * @returns Pipeline stages for a role distribution breakdown.
 *
 * @example
 * ```ts
 * const pipeline = buildRoleDistributionPipeline();
 * // Returns: [{ role: 'user', count: 150 }, { role: 'admin', count: 5 }]
 * ```
 */
export function buildRoleDistributionPipeline(): PipelineStage[] {
	return [
		{ $match: { isActive: true } },
		{ $group: { _id: '$role', count: { $sum: 1 } } },
		{ $project: { _id: 0, role: '$_id', count: 1 } },
		{ $sort: { count: -1 } },
	];
}

/**
 * Build a pipeline for user registration trends over time.
 *
 * @param startDate - Start of the analysis window.
 * @param endDate   - End of the analysis window.
 * @param granularity - 'day' | 'week' | 'month' (time bucket size).
 * @returns Pipeline stages for registration trend data.
 *
 * @example
 * ```ts
 * const pipeline = buildRegistrationTrendPipeline(
 *   new Date('2025-01-01'),
 *   new Date('2025-12-31'),
 *   'month',
 * );
 * ```
 */
export function buildRegistrationTrendPipeline(
	startDate: Date,
	endDate: Date,
	granularity: 'day' | 'week' | 'month' = 'month',
): PipelineStage[] {
	const dateGrouping: Record<string, unknown> =
		granularity === 'day'
			? { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } }
			: granularity === 'week'
				? { year: { $isoWeekYear: '$createdAt' }, week: { $isoWeek: '$createdAt' } }
				: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } };

	return [
		{
			$match: {
				createdAt: { $gte: startDate, $lte: endDate },
			},
		},
		{
			$group: {
				_id: dateGrouping,
				registrations: { $sum: 1 },
				activeRegistrations: {
					$sum: { $cond: ['$isActive', 1, 0] },
				},
			},
		},
		{
			$project: {
				_id: 0,
				period: '$_id',
				registrations: 1,
				activeRegistrations: 1,
				churnedRegistrations: {
					$subtract: ['$registrations', '$activeRegistrations'],
				},
			},
		},
		{ $sort: { period: 1 } },
	];
}
