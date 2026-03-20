import type { Server, Socket } from 'socket.io';

import { logger } from '../../../shared/utils/logger.js';
import { NotificationSocketController } from '../controllers/notification.controller.js';
import type { ISocketData } from '../middleware/socket-auth.middleware.js';

/**
 * Connection Handler — orchestrates socket lifecycle events.
 *
 * Architectural reasoning: The connection handler is the WebSocket equivalent
 * of Express route registration. It wires up domain-specific socket controllers
 * on each new connection, keeping the top-level socket setup clean.
 */
export function registerConnectionHandler(io: Server): void {
	const notificationController = new NotificationSocketController(io);

	io.on('connection', (socket: Socket) => {
		const userId = (socket.data as ISocketData).user.sub;
		logger.info({ socketId: socket.id, userId }, 'Client connected');

		/* Join a user-specific room for targeted pushes. */
		void socket.join(`user:${userId}`);

		/* Register domain-specific event handlers. */
		notificationController.registerHandlers(socket);

		/* Graceful disconnect logging. */
		socket.on('disconnect', (reason: string) => {
			logger.info({ socketId: socket.id, userId, reason }, 'Client disconnected');
		});

		socket.on('error', (err: Error) => {
			logger.error({ socketId: socket.id, userId, err }, 'Socket error');
		});
	});
}
