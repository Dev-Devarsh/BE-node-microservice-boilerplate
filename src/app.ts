import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/index.js';
import { authRoutes } from './modules/auth/routes/index.js';
import { userRoutes } from './modules/user/routes/index.js';
import { globalErrorHandler } from './shared/middleware/index.js';
import { ResponseHelper } from './shared/utils/index.js';

/**
 * Express Application Factory.
 *
 * Architectural reasoning: The app is created by a factory function (not a
 * module-level singleton) so it can be instantiated independently in tests
 * with a fresh middleware stack. The HTTP server is created separately in
 * `server.ts`, allowing Socket.io to attach to the same server instance.
 *
 * Middleware order matters:
 * 1. Security headers (helmet) — sets CSP, HSTS, etc. FIRST.
 * 2. CORS — rejects disallowed origins before any processing.
 * 3. Rate limiter — blocks abusive IPs before parsing the body.
 * 4. Body parser — only runs for requests that passed security checks.
 * 5. Routes — domain-specific handlers.
 * 6. 404 catch-all — after all routes, before error handler.
 * 7. Global error handler — LAST, catches everything.
 */
export function createApp(): express.Application {
	const app = express();

	/* ─── 1. Security Headers ──────────────────────────────────────────── */
	app.use(helmet());

	/* ─── 2. CORS ──────────────────────────────────────────────────────── */
	app.use(
		cors({
			origin: env.CORS_ORIGIN,
			methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization'],
			exposedHeaders: ['X-Total-Count'],
			credentials: true,
			maxAge: 86_400,
		}),
	);

	/* ─── 3. Rate Limiting ─────────────────────────────────────────────── */
	app.use(
		rateLimit({
			windowMs: env.RATE_LIMIT_WINDOW_MS,
			max: env.RATE_LIMIT_MAX_REQUESTS,
			standardHeaders: true,
			legacyHeaders: false,
			message: {
				success: false,
				data: null,
				error: {
					code: 'RATE_LIMIT_EXCEEDED',
					message: 'Too many requests, please try again later',
				},
				meta: null,
			},
		}),
	);

	/* ─── 4. Body Parsing ──────────────────────────────────────────────── */
	app.use(express.json({ limit: '10kb' }));
	app.use(express.urlencoded({ extended: false, limit: '10kb' }));

	/* ─── 5. Health Check ──────────────────────────────────────────────── */
	app.get('/health', (_req, res) => {
		ResponseHelper.success(res, {
			status: 'healthy',
			uptime: process.uptime(),
			timestamp: new Date().toISOString(),
		});
	});

	/* ─── 6. Swagger UI — interactive API docs at /api-docs ────────────── */
	if (env.NODE_ENV !== 'production') {
		const swaggerPath = resolve(__dirname, '../docs/swagger.json');
		const swaggerDocument = JSON.parse(readFileSync(swaggerPath, 'utf-8')) as Record<string, unknown>;
		app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
			customSiteTitle: 'Microservice API Docs',
			customCss: '.swagger-ui .topbar { display: none }',
			swaggerOptions: {
				persistAuthorization: true,
			},
		}));
	}

	/* ─── 7. API Routes ────────────────────────────────────────────────── */
	app.use('/api/v1/auth', authRoutes);
	app.use('/api/v1/users', userRoutes);

	/* ─── 8. 404 Catch-All ─────────────────────────────────────────────── */
	app.all('*', (req, res) => {
		ResponseHelper.error(res, 404, {
			code: 'ROUTE_NOT_FOUND',
			message: `Cannot ${req.method} ${req.originalUrl}`,
		});
	});

	/* ─── 9. Global Error Handler ──────────────────────────────────────── */
	app.use(globalErrorHandler);

	return app;
}
