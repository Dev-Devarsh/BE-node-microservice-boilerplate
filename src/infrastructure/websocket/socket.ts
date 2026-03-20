import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import { env } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

import { registerConnectionHandler } from './handlers/connection.handler.js';
import { socketAuthMiddleware } from './middleware/socket-auth.middleware.js';

/**
 * Socket.io server factory.
 *
 * Architectural reasoning: The socket server is attached to the existing
 * HTTP server so both Express and WebSocket traffic share the same port.
 * This simplifies load balancer configuration and TLS termination.
 *
 * CORS is configured identically to the Express CORS middleware to
 * prevent mismatched origin policies.
 *
 * Redis Adapter: When `REDIS_URL` is set, the `@socket.io/redis-adapter`
 * is dynamically imported and attached. This allows multiple Node.js
 * processes (or Kubernetes pods) to broadcast events to sockets connected
 * to ANY process — critical for horizontal scaling.
 */
export async function createSocketServer(httpServer: HttpServer): Promise<Server> {
	const io = new Server(httpServer, {
		cors: {
			origin: env.CORS_ORIGIN,
			methods: ['GET', 'POST'],
			credentials: true,
		},
		pingInterval: 25_000,
		pingTimeout: 20_000,
		maxHttpBufferSize: 1e6,
		transports: ['websocket', 'polling'],
	});

	/* Authenticate every connection at the handshake level. */
	io.use(socketAuthMiddleware);

	/* Wire up domain event handlers. */
	registerConnectionHandler(io);

	/* Optional: Redis adapter for horizontal scaling. */
	if (env.REDIS_URL != null) {
		try {
			const { createAdapter } = await import('@socket.io/redis-adapter');
			const { createClient } = await import('redis');

			const pubClient = createClient({ url: env.REDIS_URL });
			const subClient = pubClient.duplicate();

			await Promise.all([pubClient.connect(), subClient.connect()]);

			io.adapter(createAdapter(pubClient, subClient));
			logger.info('Socket.io Redis adapter connected — horizontal scaling enabled');
		} catch (err) {
			logger.warn({ err }, 'Redis adapter setup failed — falling back to in-memory adapter');
		}
	}

	logger.info('Socket.io server initialized');
	return io;
}
