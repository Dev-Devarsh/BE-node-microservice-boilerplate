import { Router } from 'express';

import { authenticate, validate } from '../../../shared/middleware/index.js';
import { asyncHandler } from '../../../shared/utils/index.js';
import { UserController } from '../controller/index.js';
import { UserRepository } from '../repository/index.js';
import { UserService } from '../service/index.js';
import { updateUserSchema } from '../validation/index.js';

/**
 * User Routes — wires HTTP verbs to controller methods.
 *
 * @module modules/user/routes/user.routes
 *
 * @description
 * Route files are the **composition root** for each module. They
 * instantiate the dependency chain (Repository → Service → Controller)
 * and apply middleware (auth, validation) declaratively.
 *
 * ### Middleware stack per route:
 * ```
 * authenticate → [validate] → asyncHandler(controller.method)
 * ```
 *
 * ### Why `asyncHandler` wraps every controller:
 * Express 4 does not catch rejected promises. `asyncHandler` ensures
 * that any exception thrown by async controller methods is forwarded
 * to the global error handler.
 *
 * ### Route ordering:
 * Static routes (e.g., `/analytics/retention`) MUST be defined BEFORE
 * parameterized routes (e.g., `/:id`), otherwise Express will treat
 * "analytics" as an ID value.
 */
const router = Router();

/* ─── Dependency Wiring ────────────────────────────────────────────── */
const userRepository = new UserRepository();
const userService = new UserService(userRepository);
const userController = new UserController(userService);

/* ─── Analytics (static paths — must come before /:id) ─────────────── */

router.get(
	'/analytics/retention',
	asyncHandler(authenticate),
	asyncHandler((req, res) => userController.getRetentionStats(req, res)),
);

router.get(
	'/analytics/roles',
	asyncHandler(authenticate),
	asyncHandler((req, res) => userController.getRoleDistribution(req, res)),
);

router.get(
	'/analytics/trends',
	asyncHandler(authenticate),
	asyncHandler((req, res) => userController.getRegistrationTrends(req, res)),
);

/* ─── CRUD ─────────────────────────────────────────────────────────── */

router.get(
	'/',
	asyncHandler(authenticate),
	asyncHandler((req, res) => userController.getUsers(req, res)),
);

router.get(
	'/:id',
	asyncHandler(authenticate),
	asyncHandler((req, res) => userController.getUser(req, res)),
);

router.patch(
	'/:id',
	asyncHandler(authenticate),
	validate(updateUserSchema),
	asyncHandler((req, res) => userController.updateUser(req, res)),
);

router.delete(
	'/:id',
	asyncHandler(authenticate),
	asyncHandler((req, res) => userController.deleteUser(req, res)),
);

export { router as userRoutes };
