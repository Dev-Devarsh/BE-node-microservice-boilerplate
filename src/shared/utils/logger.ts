import pino from 'pino';

import { env } from '../../config/index.js';

/**
 * Structured JSON logger — pino.
 *
 * Architectural reasoning: Structured logging is non-negotiable in production
 * microservices. JSON logs are machine-parseable by log aggregators (ELK,
 * Datadog, CloudWatch). Pino is chosen for its near-zero overhead — it logs
 * asynchronously and avoids string concatenation on the hot path.
 *
 * In development, `pino-pretty` can be piped: `node dist/server.js | pino-pretty`
 */
export const logger = pino({
	level: env.LOG_LEVEL,
	timestamp: pino.stdTimeFunctions.isoTime,
	formatters: {
		level(label) {
			return { level: label };
		},
	},
	redact: {
		paths: ['req.headers.authorization', 'req.headers.cookie', 'body.password'],
		censor: '[REDACTED]',
	},
});
