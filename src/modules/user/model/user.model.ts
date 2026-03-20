import type { Document, Model } from 'mongoose';
import { Schema, model } from 'mongoose';

/**
 * Domain-level User interface — the canonical shape of a User entity.
 *
 * Architectural reasoning: This interface is the single source of truth for
 * the User domain. Mongoose schemas, DTOs, and service signatures all derive
 * from or reference this type, preventing drift between layers.
 */
export interface IUser {
	readonly email: string;
	readonly password: string;
	readonly firstName: string;
	readonly lastName: string;
	readonly role: 'user' | 'admin';
	readonly isActive: boolean;
	readonly lastLoginAt: Date | null;
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/** Mongoose document type — extends IUser with Mongoose document methods. */
export interface IUserDocument extends IUser, Document {}

/** Static model methods — extend as needed for domain queries. */
export interface IUserModel extends Model<IUserDocument> {
	findByEmail(email: string): Promise<IUserDocument | null>;
}

/**
 * User Schema with strict type enforcement and strategic indexing.
 *
 * Index strategy:
 * - `email` (single-field, unique) — covers login lookups and duplicate checks.
 * - `{ role, createdAt }` (compound) — covers admin dashboard queries
 *   filtering by role and sorting by registration date.
 * - `{ email: 1 }` (partial, where isActive=true) — ensures email uniqueness
 *   only for active accounts, allowing soft-deleted accounts to reuse emails.
 */
const userSchema = new Schema<IUserDocument, IUserModel>(
	{
		email: {
			type: String,
			required: [true, 'Email is required'],
			lowercase: true,
			trim: true,
			maxlength: 255,
		},
		password: {
			type: String,
			required: [true, 'Password is required'],
			minlength: 8,
			select: false,
		},
		firstName: {
			type: String,
			required: [true, 'First name is required'],
			trim: true,
			maxlength: 100,
		},
		lastName: {
			type: String,
			required: [true, 'Last name is required'],
			trim: true,
			maxlength: 100,
		},
		role: {
			type: String,
			enum: ['user', 'admin'],
			default: 'user',
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		lastLoginAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
		toJSON: {
			transform(_doc, ret: Record<string, unknown>) {
				delete ret['password'];
				delete ret['__v'];
				return ret;
			},
		},
	},
);

/**
 * Single-field index on email — covers login lookups.
 * The `unique` constraint is NOT here because we use a partial index below.
 */
userSchema.index({ email: 1 });

/**
 * Compound index — covers admin dashboard queries:
 * "Get all admins sorted by newest" or "Get all users created after X".
 */
userSchema.index({ role: 1, createdAt: -1 });

/**
 * Partial index — unique email constraint ONLY for active accounts.
 * This allows soft-deleted (isActive=false) users to free their email
 * for re-registration without violating uniqueness.
 */
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

/**
 * Static method — encapsulates email-based lookup with password field included.
 * Used by the auth service during login.
 */
userSchema.statics.findByEmail = function (email: string): Promise<IUserDocument | null> {
	return this.findOne({ email, isActive: true }).select('+password').exec();
};

export const UserModel = model<IUserDocument, IUserModel>('User', userSchema);
