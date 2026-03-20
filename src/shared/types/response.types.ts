/**
 * Standardized API Response Envelope
 *
 * Architectural reasoning: Mobile clients (React Native / Flutter) require a
 * deterministic response shape so they can build a single generic HTTP client
 * without per-endpoint parsing logic. Every API response — success or failure —
 * follows this contract, making client-side error handling trivial and enabling
 * typed code generation from OpenAPI specs.
 */

/** Pagination metadata — always present on list endpoints, null otherwise. */
export interface IPaginationMeta {
	readonly page: number;
	readonly limit: number;
	readonly totalDocs: number;
	readonly totalPages: number;
	readonly hasNextPage: boolean;
	readonly hasPrevPage: boolean;
}

/** Structured error payload — never exposes internals in production. */
export interface IErrorDetail {
	readonly code: string;
	readonly message: string;
	readonly details?: ReadonlyArray<{ readonly field: string; readonly message: string }>;
}

/**
 * The canonical JSON envelope wrapping every HTTP response.
 *
 * @typeParam T — the shape of the `data` payload on success responses.
 */
export interface IApiResponse<T> {
	readonly success: boolean;
	readonly data: T | null;
	readonly error: IErrorDetail | null;
	readonly meta: IPaginationMeta | null;
}
