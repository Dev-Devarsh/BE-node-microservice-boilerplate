import { z } from 'zod';

/**
 * Runtime environment schema — validated at process boot.
 *
 * Architectural reasoning: Environment variables are an untyped external input
 * boundary. Parsing them through Zod at startup converts them into a strongly-typed,
 * validated config object and fails fast with a clear error message if any required
 * variable is missing or malformed, rather than failing silently at runtime.
 */
const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	PORT: z.coerce.number().int().positive().default(3000),

	MONGODB_URI: z.string().url(),

	JWT_SECRET: z.string().min(32),
	JWT_ACCESS_EXPIRATION: z.string().default('15m'),
	JWT_REFRESH_EXPIRATION: z.string().default('7d'),

	CORS_ORIGIN: z.string().default('http://localhost:3000'),

	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
	RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

	REDIS_URL: z.string().url().optional(),

	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Parse and freeze the environment config once. If validation fails, the
 * process exits immediately with a descriptive error — no partial boot.
 */
function loadEnvConfig(): EnvConfig {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		const formatted = result.error.flatten().fieldErrors;
		// eslint-disable-next-line no-console
		console.error('❌ Invalid environment variables:', JSON.stringify(formatted, null, 2));
		process.exit(1);
	}

	return Object.freeze(result.data);
}

export const env = loadEnvConfig();
