import type { Db } from 'mongodb';

import type { IMigration } from '../infrastructure/migration/index.js';

/**
 * Migration: Create Sessions Collection with Indexes
 *
 * @description
 * Creates the `sessions` collection used by the retention analytics
 * aggregation pipeline. Each session document tracks a user's login event.
 *
 * ### Indexes:
 * 1. `{ userId, createdAt }` — covers the `$lookup` sub-pipeline in the
 *    retention aggregation (filters sessions by userId and date range).
 * 2. `{ createdAt: 1 }` with TTL (90 days) — auto-expires old session
 *    records to prevent unbounded collection growth.
 *
 * ### Why TTL index:
 * Session data older than 90 days is rarely needed for analytics.
 * MongoDB's TTL index automatically deletes expired documents in the
 * background, eliminating the need for a cron job.
 */
const migration: IMigration = {
	description: 'Create sessions collection with userId+createdAt index and TTL',

	async up(db: Db): Promise<void> {
		const collections = await db.listCollections({ name: 'sessions' }).toArray();
		if (collections.length === 0) {
			await db.createCollection('sessions');
		}

		const sessions = db.collection('sessions');

		await sessions.createIndex(
			{ userId: 1, createdAt: 1 },
			{ name: 'idx_session_userId_createdAt' },
		);

		await sessions.createIndex(
			{ createdAt: 1 },
			{
				name: 'idx_session_ttl_90d',
				expireAfterSeconds: 90 * 24 * 60 * 60,
			},
		);
	},

	async down(db: Db): Promise<void> {
		await db.dropCollection('sessions').catch(() => { /* may not exist */ });
	},
};

export default migration;
