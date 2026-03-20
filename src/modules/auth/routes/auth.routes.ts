import { Router } from 'express';

import { authenticate, validate } from '../../../shared/middleware/index.js';
import { asyncHandler } from '../../../shared/utils/index.js';
import { UserRepository } from '../../user/repository/index.js';
import { AuthController } from '../controller/index.js';
import { AuthService } from '../service/index.js';
import { loginUserSchema, registerUserSchema } from '../validation/index.js';

/**
 * Auth Routes — public + protected endpoints for authentication lifecycle.
 *
 * @module modules/auth/routes/auth.routes
 *
 * @description
 * - `/register` and `/login` are **public** — they are the entry points
 *   for obtaining JWT tokens.
 * - `/logout` is **protected** — requires a valid token to blacklist it.
 *
 * Validation middleware runs BEFORE the controller to reject malformed
 * payloads at the transport boundary.
 */
const router = Router();

/* ─── Dependency Wiring ────────────────────────────────────────────── */
const userRepository = new UserRepository();
const authService = new AuthService(userRepository);
const authController = new AuthController(authService);

/* ─── Public Routes ────────────────────────────────────────────────── */

router.post(
	'/register',
	validate(registerUserSchema),
	asyncHandler((req, res) => authController.register(req, res)),
);

router.post(
	'/login',
	validate(loginUserSchema),
	asyncHandler((req, res) => authController.login(req, res)),
);

/* ─── Protected Routes ─────────────────────────────────────────────── */

router.post(
	'/logout',
	asyncHandler(authenticate),
	asyncHandler((req, res) => authController.logout(req, res)),
);

export { router as authRoutes };
