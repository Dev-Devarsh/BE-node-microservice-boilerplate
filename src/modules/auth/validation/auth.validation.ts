/**
 * Auth validation schemas re-export the user registration/login schemas.
 *
 * Architectural reasoning: Auth and User are separate bounded contexts,
 * but auth endpoints validate user-shaped payloads. Re-exporting keeps
 * the auth module self-contained while avoiding schema duplication.
 */
export {
	loginUserSchema,
	registerUserSchema,
} from '../../user/validation/index.js';
export type {
	LoginUserDto,
	RegisterUserDto,
} from '../../user/validation/index.js';
