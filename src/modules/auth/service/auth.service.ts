import argon2 from 'argon2';
import jwt from 'jsonwebtoken';

import { env } from '../../../config/index.js';
import { ConflictError, UnauthorizedError } from '../../../shared/errors/index.js';
import type { IJwtPayload } from '../../../shared/middleware/index.js';
import { UserRepository } from '../../user/repository/index.js';
import type { LoginUserDto, RegisterUserDto } from '../validation/index.js';

/** Token pair returned to the client on successful authentication. */
export interface IAuthTokens {
	readonly accessToken: string;
	readonly refreshToken: string;
}

/** Safe user shape — password excluded. */
export interface ISafeUser {
	readonly email: string;
	readonly firstName: string;
	readonly lastName: string;
	readonly role: string;
	readonly isActive: boolean;
	readonly lastLoginAt: Date | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** Combined response for register/login endpoints. */
export interface IAuthResult {
	readonly user: ISafeUser;
	readonly tokens: IAuthTokens;
}

/**
 * Authentication Service — handles registration, login, and token issuance.
 *
 * Architectural reasoning: Auth logic is isolated from the User CRUD service
 * because authentication is a cross-cutting concern with its own security
 * requirements (password hashing, token signing, brute-force protection).
 * Keeping it separate also prevents circular dependencies if other modules
 * need to authenticate without importing the full User module.
 *
 * Password hashing: Argon2id is used (winner of the Password Hashing
 * Competition). It is resistant to GPU cracking, side-channel attacks,
 * and provides built-in salt generation. The memory cost and parallelism
 * are tuned for server-side use (not mobile).
 */
export class AuthService {
	constructor(private readonly userRepository: UserRepository) {}

	/**
	 * Register a new user.
	 *
	 * @throws ConflictError if an active user with the same email exists.
	 */
	async register(dto: RegisterUserDto): Promise<IAuthResult> {
		const exists = await this.userRepository.existsByEmail(dto.email);
		if (exists) {
			throw new ConflictError('An account with this email already exists');
		}

		const hashedPassword = await argon2.hash(dto.password, {
			type: argon2.argon2id,
			memoryCost: 65536,
			timeCost: 3,
			parallelism: 4,
		});

		const user = await this.userRepository.create({
			...dto,
			password: hashedPassword,
		});

		const tokens = this.generateTokenPair(user.id as string, user.email);

		return {
			user: user.toJSON() as unknown as ISafeUser,
			tokens,
		};
	}

	/**
	 * Authenticate a user by email and password.
	 *
	 * @throws UnauthorizedError on invalid credentials (generic message
	 * to prevent user enumeration).
	 */
	async login(dto: LoginUserDto): Promise<IAuthResult> {
		const user = await this.userRepository.findByEmailWithPassword(dto.email);

		if (user == null) {
			throw new UnauthorizedError('Invalid email or password');
		}

		const isValidPassword = await argon2.verify(user.password, dto.password);
		if (!isValidPassword) {
			throw new UnauthorizedError('Invalid email or password');
		}

		await this.userRepository.updateById(user.id as string, {
			lastLoginAt: new Date(),
		});

		const tokens = this.generateTokenPair(user.id as string, user.email);

		return {
			user: user.toJSON() as unknown as ISafeUser,
			tokens,
		};
	}

	/**
	 * Generate an access + refresh token pair.
	 *
	 * The access token is short-lived (15m default) for API calls.
	 * The refresh token is long-lived (7d default) for silent re-authentication.
	 */
	private generateTokenPair(userId: string, email: string): IAuthTokens {
		const payload: Omit<IJwtPayload, 'iat' | 'exp'> = {
			sub: userId,
			email,
		};

		const accessToken = jwt.sign(payload, env.JWT_SECRET, {
			expiresIn: env.JWT_ACCESS_EXPIRATION as string & jwt.SignOptions['expiresIn'],
		});

		const refreshToken = jwt.sign(payload, env.JWT_SECRET, {
			expiresIn: env.JWT_REFRESH_EXPIRATION as string & jwt.SignOptions['expiresIn'],
		});

		return { accessToken, refreshToken };
	}
}
