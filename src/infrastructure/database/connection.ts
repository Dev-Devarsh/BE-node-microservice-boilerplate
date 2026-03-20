import mongoose from 'mongoose';

import { env } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * MongoDB connection manager with production-grade defaults.
 *
 * Architectural reasoning: The database connection is isolated from the
 * application layer so it can be independently managed, tested, and
 * gracefully shut down. Mongoose connection options are tuned for
 * production reliability (server selection timeout, heartbeat, etc.).
 */
export async function connectDatabase(): Promise<typeof mongoose> {
	mongoose.set('strictQuery', true);

	mongoose.connection.on('connected', () => {
		logger.info('MongoDB connection established');
	});

	mongoose.connection.on('error', (err) => {
		logger.error({ err }, 'MongoDB connection error');
	});

	mongoose.connection.on('disconnected', () => {
		logger.warn('MongoDB disconnected');
	});

	const connection = await mongoose.connect(env.MONGODB_URI, {
		serverSelectionTimeoutMS: 5000,
		heartbeatFrequencyMS: 10_000,
		socketTimeoutMS: 45_000,
		maxPoolSize: 10,
		minPoolSize: 2,
		retryWrites: true,
		w: 'majority',
	});

	logger.info({ db: connection.connection.name }, 'MongoDB connected successfully');

	return connection;
}

/**
 * Gracefully close the MongoDB connection — called on SIGINT/SIGTERM.
 */
export async function disconnectDatabase(): Promise<void> {
	await mongoose.connection.close();
	logger.info('MongoDB connection closed gracefully');
}
