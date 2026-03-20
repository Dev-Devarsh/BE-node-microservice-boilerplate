import type { Db } from 'mongodb';

import type { IMigration } from '../infrastructure/migration/index.js';

/**
 * Migration: Create User Collection Indexes
 *
 * @description
 * Sets up the three strategic indexes for the `users` collection:
 *
 * 1. **Single-field index** on `email` — covers login lookups and
 *    duplicate-check queries.
 *
 * 2. **Compound index** on `{ role, createdAt }` — covers admin
 *    dashboard queries like "all admins sorted by newest."
 *
 * 3. **Partial unique index** on `email` where `isActive: true` —
 *    ensures email uniqueness only for active accounts. Soft-deleted
 *    users release their email for re-registration.
 *
 * ### Idempotency:
 * `createIndex()` is a no-op if the index already exists with the
 * same specification and options.
 *
 * ### Rollback:
 * `down()` drops all three indexes. This is safe because Mongoose
 * will recreate them on the next application boot (via `schema.index()`),
 * but in production you should verify no queries depend on them first.
 */
const migration: IMigration = {
	description: 'Create user collection indexes (email, role+createdAt, partial unique email)',

	async up(db: Db): Promise<void> {
		const users = db.collection('users');

		await users.createIndex(
			{ email: 1 },
			{ name: 'idx_user_email' },
		);

		await users.createIndex(
			{ role: 1, createdAt: -1 },
			{ name: 'idx_user_role_createdAt' },
		);

		await users.createIndex(
			{ email: 1 },
			{
				name: 'idx_user_email_unique_active',
				unique: true,
				partialFilterExpression: { isActive: true },
			},
		);
	},

	async down(db: Db): Promise<void> {
		const users = db.collection('users');

		await users.dropIndex('idx_user_email').catch(() => { /* index may not exist */ });
		await users.dropIndex('idx_user_role_createdAt').catch(() => { /* index may not exist */ });
		await users.dropIndex('idx_user_email_unique_active').catch(() => { /* index may not exist */ });
	},
};

export default migration;
