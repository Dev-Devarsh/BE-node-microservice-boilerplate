import 'dotenv/config';

import { resolve } from 'node:path';

import mongoose from 'mongoose';

import { env } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

import { MigrationRunner } from './migration.runner.js';

/**
 * Migration CLI — standalone script for running migrations.
 *
 * @module infrastructure/migration/migrate.cli
 *
 * @description
 * This script is invoked via npm scripts and handles the full lifecycle:
 * 1. Connect to MongoDB.
 * 2. Run the requested migration command (up / down / status).
 * 3. Disconnect and exit.
 *
 * ### Usage:
 * ```bash
 * npm run migrate:up      # Apply all pending migrations
 * npm run migrate:down    # Revert the last applied migration
 * npm run migrate:status  # Show migration status
 * ```
 *
 * ### Why a standalone script:
 * Migrations should be executable independently of the application server.
 * In CI/CD pipelines, migrations run as a separate step before deployment
 * (e.g., `npm run migrate:up && npm start`).
 */
async function main(): Promise<void> {
	const command = process.argv[2] ?? 'up';
	const migrationsDir = resolve(__dirname, '../../migrations');

	logger.info({ command, migrationsDir }, 'Migration CLI started');

	await mongoose.connect(env.MONGODB_URI);
	logger.info('Connected to MongoDB for migrations');

	const db = mongoose.connection.db;
	if (db == null) {
		logger.fatal('Failed to get MongoDB Db instance');
		process.exit(1);
	}

	const runner = new MigrationRunner(db, migrationsDir);

	switch (command) {
		case 'up': {
			const applied = await runner.up();
			logger.info({ applied }, `Migration up complete — ${String(applied)} applied`);
			break;
		}

		case 'down': {
			const reverted = await runner.down();
			if (reverted != null) {
				logger.info({ reverted }, 'Migration down complete');
			} else {
				logger.info('No migrations to revert');
			}
			break;
		}

		case 'status': {
			const statuses = await runner.status();
			for (const s of statuses) {
				const mark = s.status === 'applied' ? '✅' : '⏳';
				const date = s.appliedAt != null ? s.appliedAt.toISOString() : 'pending';
				// eslint-disable-next-line no-console
				console.log(`  ${mark} ${s.fileName} — ${s.description} (${date})`);
			}
			break;
		}

		default:
			logger.error({ command }, 'Unknown migration command. Use: up | down | status');
	}

	await mongoose.connection.close();
	process.exit(0);
}

main().catch((err: unknown) => {
	logger.fatal({ err }, 'Migration failed');
	process.exit(1);
});
