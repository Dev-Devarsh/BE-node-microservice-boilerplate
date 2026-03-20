import 'dotenv/config';

import { createServer } from 'node:http';

import { env } from './config/index.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/index.js';
import { connectRedis, disconnectRedis } from './infrastructure/redis/index.js';
import { createSocketServer } from './infrastructure/websocket/index.js';
import { logger } from './shared/utils/logger.js';

/**
 * Server Bootstrap — the process entry point.
 *
 * @module server
 *
 * @description
 * This file has a single responsibility: orchestrate the startup and
 * shutdown of all infrastructure dependencies in the correct order.
 *
 * ### Boot sequence (order matters):
 * 1. **Environment** — `dotenv/config` loads `.env` at import time.
 * 2. **Redis** — Connected first because the auth middleware depends
 *    on it for token blacklist checks, and Socket.io may need it
 *    for the Redis adapter.
 * 3. **MongoDB** — The primary data store.
 * 4. **Express app** — HTTP middleware stack + routes.
 * 5. **Socket.io** — Attached to the HTTP server after Express.
 * 6. **Listen** — Start accepting connections.
 * 7. **Shutdown hooks** — SIGINT/SIGTERM handlers.
 *
 * ### Shutdown sequence (reverse order):
 * 1. Socket.io — stop accepting new connections, close existing sockets.
 * 2. HTTP server — stop accepting new requests, finish in-flight ones.
 * 3. MongoDB — close the connection pool.
 * 4. Redis — close the connection.
 * 5. Exit process.
 *
 * ### Why `app.ts` and `server.ts` are separate:
 * The Express app can be imported and tested with Supertest without
 * starting the server or connecting to a real database. This is
 * essential for fast integration tests.
 */
async function bootstrap(): Promise<void> {
	/* ─── 1. Redis (non-critical — app works without it) ───────────── */
	await connectRedis();

	/* ─── 2. MongoDB (critical — app cannot function without it) ───── */
	await connectDatabase();

	/* ─── 3. HTTP + Express ────────────────────────────────────────── */
	const app = createApp();
	const httpServer = createServer(app);

	/* ─── 4. WebSocket ─────────────────────────────────────────────── */
	const io = await createSocketServer(httpServer);

	/* ─── 5. Listen ────────────────────────────────────────────────── */
	httpServer.listen(env.PORT, () => {
		logger.info(
			{ port: env.PORT, env: env.NODE_ENV },
			`Server running on port ${String(env.PORT)}`,
		);
	});

	/* ─── 6. Graceful Shutdown ─────────────────────────────────────── */
	const shutdown = async (signal: string): Promise<void> => {
		logger.info({ signal }, 'Shutdown signal received — closing connections');

		io.close(() => {
			logger.info('Socket.io server closed');
		});

		httpServer.close(() => {
			logger.info('HTTP server closed');
		});

		await disconnectDatabase();
		await disconnectRedis();

		logger.info('Graceful shutdown complete');
		process.exit(0);
	};

	process.on('SIGINT', () => void shutdown('SIGINT'));
	process.on('SIGTERM', () => void shutdown('SIGTERM'));

	process.on('unhandledRejection', (reason: unknown) => {
		logger.fatal({ reason }, 'UNHANDLED REJECTION — shutting down');
		process.exit(1);
	});

	process.on('uncaughtException', (err: Error) => {
		logger.fatal({ err }, 'UNCAUGHT EXCEPTION — shutting down');
		process.exit(1);
	});
}

bootstrap().catch((err: unknown) => {
	logger.fatal({ err }, 'Failed to bootstrap application');
	process.exit(1);
});
