import type { Server, Socket } from 'socket.io';

import { logger } from '../../../shared/utils/logger.js';
import type { ISocketData } from '../middleware/socket-auth.middleware.js';

/**
 * Notification Socket Controller — structured event handler.
 *
 * Architectural reasoning: Socket event handlers are organized into
 * controller classes mirroring the HTTP controller pattern. This avoids
 * a monolithic `io.on('connection', ...)` callback with hundreds of lines
 * and enables:
 * 1. Per-domain event namespacing.
 * 2. Testability — controllers can be unit-tested with mock socket objects.
 * 3. Separation of concerns — each controller owns its event namespace.
 */
export class NotificationSocketController {
	constructor(private readonly io: Server) {}

	/**
	 * Register event listeners for a newly connected socket.
	 * Called once per authenticated connection from the connection handler.
	 */
	registerHandlers(socket: Socket): void {
		socket.on('notification:subscribe', (data: { channel: string }) => {
			this.handleSubscribe(socket, data);
		});

		socket.on('notification:unsubscribe', (data: { channel: string }) => {
			this.handleUnsubscribe(socket, data);
		});

		socket.on('notification:broadcast', (data: { channel: string; message: string }) => {
			this.handleBroadcast(socket, data);
		});
	}

	private getUserId(socket: Socket): string {
		return (socket.data as ISocketData).user.sub;
	}

	/**
	 * Subscribe the socket to a named room (channel).
	 */
	private handleSubscribe(socket: Socket, data: { channel: string }): void {
		const { channel } = data;
		const userId = this.getUserId(socket);

		void socket.join(channel);
		logger.info({ userId, channel, socketId: socket.id }, 'User subscribed to channel');

		socket.emit('notification:subscribed', { channel });
	}

	/**
	 * Unsubscribe the socket from a named room.
	 */
	private handleUnsubscribe(socket: Socket, data: { channel: string }): void {
		const { channel } = data;
		const userId = this.getUserId(socket);

		void socket.leave(channel);
		logger.info({ userId, channel, socketId: socket.id }, 'User unsubscribed from channel');

		socket.emit('notification:unsubscribed', { channel });
	}

	/**
	 * Broadcast a message to all sockets in a channel.
	 */
	private handleBroadcast(
		socket: Socket,
		data: { channel: string; message: string },
	): void {
		const { channel, message } = data;
		const userId = this.getUserId(socket);

		this.io.to(channel).emit('notification:message', {
			channel,
			message,
			from: userId,
			timestamp: new Date().toISOString(),
		});

		logger.debug({ userId, channel }, 'Broadcast sent to channel');
	}
}
