import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Collection, Db } from 'mongodb';

import { logger } from '../../shared/utils/logger.js';

import type { IMigration } from './migration.types.js';

/**
 * Schema for tracking applied migrations in MongoDB.
 *
 * Stored in a dedicated `_migrations` collection (prefixed with underscore
 * to distinguish it from application collections).
 */
interface IMigrationRecord {
	/** Migration filename (acts as unique identifier). */
	fileName: string;
	/** Human-readable description from the migration file. */
	description: string;
	/** Timestamp when the migration was applied. */
	appliedAt: Date;
}

/**
 * Migration Runner — applies and reverts database migrations.
 *
 * @module infrastructure/migration/migration.runner
 *
 * @description
 * A lightweight, framework-free migration system built on top of the
 * raw MongoDB driver. Migrations are TypeScript files in the `migrations/`
 * directory, sorted by filename (timestamp prefix).
 *
 * ### How it works:
 * 1. Reads all `*.ts` / `*.js` files from the migrations directory.
 * 2. Queries the `_migrations` collection for already-applied migrations.
 * 3. Applies pending migrations in order (oldest first).
 * 4. Records each successful migration in `_migrations`.
 *
 * ### Migration file naming convention:
 * ```
 * YYYYMMDDHHMMSS_description.ts
 * e.g., 20250101120000_create-user-indexes.ts
 * ```
 *
 * ### Idempotency:
 * All migrations MUST be idempotent. The runner tracks applied migrations,
 * but the migration code itself should also be safe to run twice (e.g.,
 * use `createIndex()` which is a no-op if the index exists).
 *
 * ### Why not migrate-mongo:
 * - Zero external dependencies.
 * - TypeScript-native (no JS transpilation step for migration files).
 * - Tight integration with our logging and error handling.
 * - Full control over the migration lifecycle.
 */
export class MigrationRunner {
	private readonly migrationsDir: string;
	private readonly collectionName = '_migrations';

	/**
	 * @param db            - Raw MongoDB `Db` instance.
	 * @param migrationsDir - Absolute path to the migrations directory.
	 */
	constructor(
		private readonly db: Db,
		migrationsDir: string,
	) {
		this.migrationsDir = migrationsDir;
	}

	/**
	 * Get the migrations tracking collection.
	 */
	private getCollection(): Collection<IMigrationRecord> {
		return this.db.collection<IMigrationRecord>(this.collectionName);
	}

	/**
	 * Read all migration files from disk, sorted by filename.
	 *
	 * @returns Array of migration filenames in chronological order.
	 */
	private async getMigrationFiles(): Promise<string[]> {
		try {
			const files = await readdir(this.migrationsDir);
			return files
				.filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
				.sort();
		} catch {
			logger.warn({ dir: this.migrationsDir }, 'Migrations directory not found');
			return [];
		}
	}

	/**
	 * Get the set of already-applied migration filenames.
	 */
	private async getAppliedMigrations(): Promise<Set<string>> {
		const records = await this.getCollection()
			.find({})
			.project<{ fileName: string }>({ fileName: 1 })
			.toArray();

		return new Set(records.map((r) => r.fileName));
	}

	/**
	 * Run all pending migrations.
	 *
	 * @returns Number of migrations applied.
	 *
	 * @remarks
	 * Migrations are applied sequentially (not in parallel) to preserve
	 * ordering guarantees. If any migration fails, subsequent migrations
	 * are skipped and the error is propagated.
	 *
	 * @example
	 * ```ts
	 * const runner = new MigrationRunner(db, migrationsPath);
	 * const applied = await runner.up();
	 * logger.info({ applied }, 'Migrations complete');
	 * ```
	 */
	async up(): Promise<number> {
		const files = await this.getMigrationFiles();
		const applied = await this.getAppliedMigrations();

		const pending = files.filter((f) => !applied.has(f));

		if (pending.length === 0) {
			logger.info('No pending migrations');
			return 0;
		}

		logger.info({ count: pending.length }, 'Running pending migrations...');

		let count = 0;
		for (const fileName of pending) {
			const filePath = join(this.migrationsDir, fileName);
			const migration = (await import(filePath)) as { default: IMigration };
			const migrationInstance = migration.default;

			logger.info({ fileName, description: migrationInstance.description }, 'Applying migration');

			await migrationInstance.up(this.db);

			await this.getCollection().insertOne({
				fileName,
				description: migrationInstance.description,
				appliedAt: new Date(),
			});

			logger.info({ fileName }, 'Migration applied successfully');
			count++;
		}

		return count;
	}

	/**
	 * Revert the most recently applied migration.
	 *
	 * @returns The filename of the reverted migration, or `null` if none.
	 *
	 * @example
	 * ```ts
	 * const reverted = await runner.down();
	 * if (reverted) logger.info({ reverted }, 'Migration reverted');
	 * ```
	 */
	async down(): Promise<string | null> {
		const lastApplied = await this.getCollection()
			.find({})
			.sort({ appliedAt: -1 })
			.limit(1)
			.toArray();

		if (lastApplied.length === 0) {
			logger.info('No migrations to revert');
			return null;
		}

		const record = lastApplied[0];
		if (record == null) return null;

		const filePath = join(this.migrationsDir, record.fileName);
		const migration = (await import(filePath)) as { default: IMigration };
		const migrationInstance = migration.default;

		logger.info({ fileName: record.fileName, description: record.description }, 'Reverting migration');

		await migrationInstance.down(this.db);
		await this.getCollection().deleteOne({ fileName: record.fileName });

		logger.info({ fileName: record.fileName }, 'Migration reverted successfully');
		return record.fileName;
	}

	/**
	 * Get the migration status — which are applied and which are pending.
	 *
	 * @returns Array of status objects for display.
	 */
	async status(): Promise<
		Array<{
			fileName: string;
			status: 'applied' | 'pending';
			appliedAt: Date | null;
			description: string;
		}>
	> {
		const files = await this.getMigrationFiles();
		const applied = await this.getAppliedMigrations();

		const appliedRecords = await this.getCollection().find({}).toArray();
		const recordMap = new Map(appliedRecords.map((r) => [r.fileName, r]));

		return files.map((fileName) => {
			const record = recordMap.get(fileName);
			return {
				fileName,
				status: applied.has(fileName) ? 'applied' as const : 'pending' as const,
				appliedAt: record?.appliedAt ?? null,
				description: record?.description ?? '(pending)',
			};
		});
	}
}
