import type { Db } from 'mongodb';

/**
 * Migration file contract.
 *
 * @module infrastructure/migration/migration.types
 *
 * @description
 * Every migration file must export an object conforming to this interface.
 * Migrations are run sequentially in filename order (timestamp prefix).
 *
 * ### Design:
 * - `up()` — applies the migration (create indexes, alter collections, seed data).
 * - `down()` — reverts the migration (drop indexes, undo schema changes).
 * - Both receive a raw `mongodb.Db` instance (NOT Mongoose) to avoid
 *   coupling migrations to the application's Mongoose schema version.
 *
 * ### Why raw `mongodb.Db` instead of Mongoose:
 * Migrations often need to modify schemas that Mongoose hasn't loaded yet,
 * or alter data in ways that would violate current Mongoose validators.
 * Using the raw driver provides unrestricted access.
 */
export interface IMigration {
	/** Human-readable description shown in the migration log. */
	readonly description: string;

	/** Apply the migration. Must be idempotent (safe to run twice). */
	up(db: Db): Promise<void>;

	/** Revert the migration. Must be idempotent. */
	down(db: Db): Promise<void>;
}
