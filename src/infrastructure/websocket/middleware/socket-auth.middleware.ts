import jwt from 'jsonwebtoken';
import type { Socket } from 'socket.io';

import { env } from '../../../config/index.js';
import type { IJwtPayload } from '../../../shared/middleware/index.js';
import { logger } from '../../../shared/utils/logger.js';

/**
 * Socket data shape — carried on `socket.data` after auth middleware.
 *
 * Architectural reasoning: Just as Express requests carry `req.user` after
 * HTTP auth, socket instances carry `socket.data.user` after the handshake
 * auth middleware. This provides consistent auth semantics across transports.
 */
export interface ISocketData {
	user: IJwtPayload;
}

/**
 * Socket.io authentication middleware — runs ONCE during the handshake.
 *
 * Architectural reasoning: Verifying JWT at the handshake level means:
 * 1. Unauthenticated clients are rejected BEFORE establishing a persistent
 *    WebSocket connection, saving server resources.
 * 2. Event handlers can trust `socket.data.user` is always populated.
 * 3. Token-based auth works identically to HTTP — the client sends the
 *    token as `auth.token` in the connection options.
 */
export function socketAuthMiddleware(
	socket: Socket,
	next: (err?: Error) => void,
): void {
	const token = socket.handshake.auth['token'] as string | undefined;

	if (token == null || token.trim() === '') {
		logger.warn({ socketId: socket.id }, 'Socket connection rejected: missing token');
		next(new Error('Authentication required'));
		return;
	}

	try {
		const decoded = jwt.verify(token, env.JWT_SECRET) as IJwtPayload;
		(socket.data as ISocketData) = { user: decoded };
		logger.debug({ socketId: socket.id, userId: decoded.sub }, 'Socket authenticated');
		next();
	} catch {
		logger.warn({ socketId: socket.id }, 'Socket connection rejected: invalid token');
		next(new Error('Invalid or expired token'));
	}
}
