import { z } from 'zod';

/**
 * Zod schemas for User-related request validation.
 *
 * Architectural reasoning: Schemas live in the module's validation layer,
 * co-located with the domain they protect. They serve double duty:
 * 1. Runtime validation via the `validate` middleware.
 * 2. TypeScript type inference (`z.infer<typeof schema>`) ensuring the
 *    controller receives a correctly-typed payload without manual casting.
 */

export const registerUserSchema = z.object({
	email: z.string().email('Invalid email format').max(255).trim().toLowerCase(),
	password: z
		.string()
		.min(8, 'Password must be at least 8 characters')
		.max(128, 'Password must not exceed 128 characters')
		.regex(
			/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/,
			'Password must contain uppercase, lowercase, digit, and special character',
		),
	firstName: z.string().min(1).max(100).trim(),
	lastName: z.string().min(1).max(100).trim(),
});

export const loginUserSchema = z.object({
	email: z.string().email('Invalid email format').trim().toLowerCase(),
	password: z.string().min(1, 'Password is required'),
});

export const updateUserSchema = z.object({
	firstName: z.string().min(1).max(100).trim().optional(),
	lastName: z.string().min(1).max(100).trim().optional(),
});

export const paginationSchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	limit: z.coerce.number().int().positive().max(100).default(20),
});

export type RegisterUserDto = z.infer<typeof registerUserSchema>;
export type LoginUserDto = z.infer<typeof loginUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type PaginationDto = z.infer<typeof paginationSchema>;
