# Enterprise Node.js Microservice Boilerplate

Production-ready, enterprise-grade Node.js microservice with Domain-Driven Design, layered clean architecture, Redis caching, database migrations, and horizontal WebSocket scalability.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Folder Structure](#folder-structure)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [API Response Envelope](#api-response-envelope)
- [Query Store — Stored Procedure Pattern](#query-store--stored-procedure-pattern)
- [Redis Integration](#redis-integration)
- [Database Migrations](#database-migrations)
- [WebSocket (Socket.io)](#websocket-socketio)
- [Security Features](#security-features)
- [Caching Strategy](#caching-strategy)
- [Error Handling Architecture](#error-handling-architecture)
- [Graceful Shutdown](#graceful-shutdown)
- [Testing](#testing)
- [Code Quality & Git Hooks](#code-quality--git-hooks)
- [npm Scripts Reference](#npm-scripts-reference)
- [Horizontal Scaling](#horizontal-scaling)
- [Project Conventions](#project-conventions)

---

## Tech Stack

| Layer            | Technology                                   | Purpose                                           |
| ---------------- | -------------------------------------------- | ------------------------------------------------- |
| Runtime          | Node.js 20+                                  | JavaScript runtime                                |
| Language         | TypeScript (strict mode)                     | Type safety with `exactOptionalPropertyTypes`     |
| Framework        | Express.js                                   | HTTP server + routing                             |
| Database         | MongoDB + Mongoose                           | Document store with ODM                           |
| Cache / KV Store | Redis                                        | Caching, token blacklist, pub/sub                 |
| Auth             | JWT (access + refresh) + Argon2id            | Stateless auth with revocation support            |
| WebSocket        | Socket.io + Redis adapter                    | Real-time events with horizontal scaling          |
| Validation       | Zod                                          | Runtime validation + TypeScript type inference    |
| Logging          | Pino                                         | Structured JSON logging with redaction            |
| Build            | tsup (esbuild)                               | Fast production bundling (minified, tree-shaken)  |
| Dev              | tsx                                          | TypeScript execution with hot-reload              |
| Lint             | ESLint (strict-type-checked)                 | Static analysis + import ordering                 |
| Format           | Prettier                                     | Code formatting                                   |
| Git Hooks        | Husky + lint-staged                          | Pre-commit quality gates                          |
| Testing          | Jest + Supertest                             | Unit + integration testing                        |

---

## Architecture Overview

This project follows **Domain-Driven Design (DDD)** with **Clean Architecture** principles. The data flow is strictly unidirectional:

```
HTTP Request
  │
  ▼
┌─────────────────────────────────────────────────────────┐
│  Express Middleware Stack                                │
│  (Helmet → CORS → Rate Limit → Body Parser)            │
└─────────┬───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐     ┌──────────────────────────┐
│  Route Definition   │────▶│  Validation Middleware    │
│  (auth.routes.ts)   │     │  (Zod schema)            │
└─────────────────────┘     └────────────┬─────────────┘
                                         │
                                         ▼
                            ┌──────────────────────────┐
                            │  Controller              │
                            │  (HTTP ↔ Service adapter) │
                            └────────────┬─────────────┘
                                         │
                                         ▼
                            ┌──────────────────────────┐
                            │  Domain Service          │
                            │  (business logic + cache) │
                            └────────────┬─────────────┘
                                         │
                                         ▼
                            ┌──────────────────────────┐
                            │  Repository              │
                            │  (data access executor)  │
                            └────────────┬─────────────┘
                                         │
                                         ▼
                            ┌──────────────────────────┐
                            │  Query Store             │
                            │  (query definitions)     │
                            └────────────┬─────────────┘
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                        ┌──────────┐          ┌──────────┐
                        │  MongoDB │          │  Redis   │
                        └──────────┘          └──────────┘
```

### Layer Responsibilities

| Layer              | Knows About                 | Does NOT Know About         |
| ------------------ | --------------------------- | --------------------------- |
| **Routes**         | Controllers, Middleware      | Services, Repositories, DB  |
| **Controllers**    | Services, ResponseHelper     | Repositories, Mongoose, Redis |
| **Services**       | Repositories, CacheService   | Express, HTTP, Controllers  |
| **Repositories**   | Query Store, Mongoose Models | Services, Controllers, HTTP |
| **Query Store**    | MongoDB query syntax only    | Everything else             |

---

## Folder Structure

```
src/
├── server.ts                                    # Process entry point, boot sequence, graceful shutdown
├── app.ts                                       # Express app factory (middleware + routes)
│
├── config/
│   ├── env.ts                                   # Zod-validated environment config (fail-fast on boot)
│   └── index.ts                                 # Barrel export
│
├── shared/                                      # Cross-cutting concerns shared across all modules
│   ├── errors/
│   │   ├── app-error.ts                         # AppError hierarchy (BadRequest, NotFound, Conflict, etc.)
│   │   └── index.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts                   # JWT verification + Redis blacklist check
│   │   ├── error-handler.middleware.ts           # Global error handler (operational vs programming errors)
│   │   ├── validate.middleware.ts               # Zod request body validation factory
│   │   └── index.ts
│   ├── types/
│   │   ├── response.types.ts                    # API response envelope interfaces
│   │   └── index.ts
│   └── utils/
│       ├── async-handler.ts                     # Express async error catcher
│       ├── logger.ts                            # Pino structured logger with redaction
│       ├── response.helper.ts                   # Standardized JSON response builder
│       └── index.ts
│
├── modules/                                     # Domain modules (bounded contexts)
│   ├── auth/
│   │   ├── controller/auth.controller.ts        # Register, Login, Logout HTTP handlers
│   │   ├── routes/auth.routes.ts                # Public + protected auth routes
│   │   ├── service/auth.service.ts              # JWT signing, Argon2 hashing, token blacklisting
│   │   └── validation/auth.validation.ts        # Zod schemas for auth payloads
│   └── user/
│       ├── controller/user.controller.ts        # CRUD + analytics HTTP handlers
│       ├── model/user.model.ts                  # Mongoose schema + TypeScript interface (single source of truth)
│       ├── queries/user.queries.ts              # ⭐ Query Store — all filters, projections, pipelines
│       ├── repository/user.repository.ts        # Data access executor (calls query store, runs via Mongoose)
│       ├── routes/user.routes.ts                # Protected user routes with dependency wiring
│       ├── service/user.service.ts              # Business logic + Redis cache-aside integration
│       └── validation/user.validation.ts        # Zod schemas + DTO type inference
│
├── infrastructure/                              # Technical infrastructure (no business logic)
│   ├── database/
│   │   ├── connection.ts                        # MongoDB connection manager (connect + disconnect)
│   │   └── index.ts
│   ├── redis/
│   │   ├── redis.client.ts                      # Redis singleton client (connect, disconnect, getClient)
│   │   ├── cache.service.ts                     # Generic cache API (get, set, invalidate, pattern invalidation)
│   │   ├── token-blacklist.service.ts           # JWT revocation via Redis (per-token + per-user revocation)
│   │   └── index.ts
│   ├── migration/
│   │   ├── migration.types.ts                   # IMigration interface (up/down contract)
│   │   ├── migration.runner.ts                  # Migration executor (apply, revert, status)
│   │   ├── migrate.cli.ts                       # Standalone CLI script for running migrations
│   │   └── index.ts
│   └── websocket/
│       ├── middleware/socket-auth.middleware.ts  # JWT handshake authentication
│       ├── controllers/notification.controller.ts # Socket event handlers (subscribe, broadcast)
│       ├── handlers/connection.handler.ts       # Socket lifecycle (connect, disconnect, error)
│       ├── socket.ts                            # Socket.io server factory + Redis adapter
│       └── index.ts
│
└── migrations/                                  # Database migration files (timestamped)
    ├── 20250101120000_create-user-indexes.ts     # User collection indexes
    └── 20250101120001_create-sessions-collection.ts # Sessions collection + TTL index
```

---

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **MongoDB** (local or Atlas)
- **Redis** (optional — app works without it, caching is skipped)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set MONGODB_URI and JWT_SECRET

# 3. Run database migrations
npm run migrate:up

# 4. Start development server (hot-reload)
npm run dev

# 5. Production build + start
npm run build
npm start
```

### Generate a secure JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Environment Variables

| Variable                 | Required | Default         | Description                                              |
| ------------------------ | -------- | --------------- | -------------------------------------------------------- |
| `NODE_ENV`               | No       | `development`   | `development`, `production`, or `test`                   |
| `PORT`                   | No       | `3000`          | HTTP server port                                         |
| `MONGODB_URI`            | **Yes**  | —               | MongoDB connection string (must be a valid URL)          |
| `JWT_SECRET`             | **Yes**  | —               | JWT signing secret (min 32 characters)                   |
| `JWT_ACCESS_EXPIRATION`  | No       | `15m`           | Access token lifetime                                    |
| `JWT_REFRESH_EXPIRATION` | No       | `7d`            | Refresh token lifetime                                   |
| `CORS_ORIGIN`            | No       | `localhost:3000` | Allowed CORS origin                                      |
| `RATE_LIMIT_WINDOW_MS`   | No       | `900000`        | Rate limit window (ms) — 15 minutes                     |
| `RATE_LIMIT_MAX_REQUESTS` | No      | `100`           | Max requests per window per IP                           |
| `REDIS_URL`              | No       | —               | Redis connection URL. Enables caching + token blacklist  |
| `LOG_LEVEL`              | No       | `info`          | Pino log level (fatal/error/warn/info/debug/trace)       |

All variables are validated at startup via Zod. Invalid or missing required variables cause an immediate exit with a descriptive error.

---

## API Reference

### Auth Endpoints (Public)

| Method | Path                   | Body                                                    | Description                       |
| ------ | ---------------------- | ------------------------------------------------------- | --------------------------------- |
| POST   | `/api/v1/auth/register` | `{ email, password, firstName, lastName }`              | Register and receive JWT tokens   |
| POST   | `/api/v1/auth/login`    | `{ email, password }`                                   | Login and receive JWT tokens      |
| POST   | `/api/v1/auth/logout`   | — (Bearer token required)                               | Blacklist the current token       |

### User Endpoints (Protected — Bearer token required)

| Method | Path                                 | Description                                  |
| ------ | ------------------------------------ | -------------------------------------------- |
| GET    | `/api/v1/users`                      | List users (paginated, optional `role` filter) |
| GET    | `/api/v1/users/:id`                  | Get user by ID                               |
| PATCH  | `/api/v1/users/:id`                  | Update user profile (firstName, lastName)    |
| DELETE | `/api/v1/users/:id`                  | Soft-delete (deactivate) own account         |
| GET    | `/api/v1/users/analytics/retention`  | Monthly retention stats (startDate, endDate) |
| GET    | `/api/v1/users/analytics/roles`      | User count by role                           |
| GET    | `/api/v1/users/analytics/trends`     | Registration trends (startDate, endDate, granularity) |

### Health Check

| Method | Path      | Description          |
| ------ | --------- | -------------------- |
| GET    | `/health` | Service health check |

---

## API Response Envelope

Every response — success or error — follows this exact contract. Mobile clients (React Native, Flutter) can build a single generic parser.

### Success Response

```json
{
  "success": true,
  "data": {
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Doe"
  },
  "error": null,
  "meta": null
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [ ... ],
  "error": null,
  "meta": {
    "page": 1,
    "limit": 20,
    "totalDocs": 150,
    "totalPages": 8,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### Error Response

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "password", "message": "Password must be at least 8 characters" }
    ]
  },
  "meta": null
}
```

---

## Query Store — Stored Procedure Pattern

The **Query Store** (`modules/<domain>/queries/`) is the equivalent of SQL stored procedures for MongoDB. It isolates all query definitions from the repository execution layer.

### Why this pattern?

| Benefit           | Explanation                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| **Separation**    | Repository decides *when* to query; Query Store decides *what* to query.    |
| **Auditability**  | All database queries for a domain are in ONE file — easy security review.   |
| **Reusability**   | Filters and projections are defined once, used everywhere.                  |
| **Testability**   | Query builders are pure functions — unit-testable without a database.       |
| **Index alignment** | Query shapes and index definitions are co-located for easy verification.  |
| **DBA-friendly**  | A database engineer can optimize queries without touching business logic.   |

### What lives in the Query Store:

```
queries/
└── user.queries.ts
    ├── SAFE_USER_PROJECTION        # { password: 0, __v: 0 }
    ├── AUTH_PROJECTION             # '+password'
    ├── DEFAULT_USER_SORT           # { createdAt: -1 }
    ├── ADMIN_DASHBOARD_SORT        # { role: 1, createdAt: -1 }
    ├── buildActiveUsersFilter()    # → { isActive: true }
    ├── buildEmailLookupFilter()    # → { email, isActive: true }
    ├── buildUserListFilter()       # → { isActive, role? }
    ├── buildRetentionPipeline()    # → PipelineStage[] (MAU retention)
    ├── buildRoleDistributionPipeline()  # → PipelineStage[]
    └── buildRegistrationTrendPipeline() # → PipelineStage[]
```

### How Repository uses Query Store:

```typescript
// Repository (executor) — calls Query Store (definition)
async findPaginated(filter, page, limit) {
  return UserModel
    .find(filter, SAFE_USER_PROJECTION)     // ← projection from query store
    .sort(DEFAULT_USER_SORT)                 // ← sort from query store
    .skip(skip).limit(limit)
    .lean().exec();
}

async getMonthlyRetentionStats(startDate, endDate) {
  const pipeline = buildRetentionPipeline(startDate, endDate);  // ← pipeline from query store
  return UserModel.aggregate(pipeline).exec();
}
```

---

## Redis Integration

Redis is an **optional but recommended** dependency. When `REDIS_URL` is configured, the following features are enabled:

### 1. Cache Service (`infrastructure/redis/cache.service.ts`)

Generic, namespace-based caching with mandatory TTLs:

```typescript
// Namespaced keys prevent collisions: "user:507f1f77bcf86cd799439011"
await cacheService.set('user', userId, userObject, 300);  // 5 min TTL
const cached = await cacheService.get<IUser>('user', userId);
await cacheService.invalidate('user', userId);
await cacheService.invalidatePattern('user');  // clear all user:* keys
```

### 2. Token Blacklist (`infrastructure/redis/token-blacklist.service.ts`)

JWT revocation without losing statelessness:

- **Per-token blacklisting** — on logout, the token is stored with TTL = remaining lifetime.
- **Per-user revocation** — on password change, a "revoked-before" timestamp invalidates all older tokens.
- **Auto-cleanup** — Redis TTL ensures expired tokens are cleaned up automatically.

### 3. Socket.io Redis Adapter

Enables WebSocket event broadcasting across multiple Node.js processes (see [Horizontal Scaling](#horizontal-scaling)).

### Graceful Degradation

If Redis is unavailable:
- Cache operations return `null` / `false` — the app falls through to MongoDB.
- Token blacklist checks return `false` (fail-open) — tokens are accepted.
- Socket.io falls back to the in-memory adapter (single-process only).

---

## Database Migrations

This project includes a **framework-free migration system** built on the raw MongoDB driver.

### Commands

```bash
npm run migrate:up       # Apply all pending migrations
npm run migrate:down     # Revert the last applied migration
npm run migrate:status   # Show applied vs pending migrations
```

### How it works

1. Migration files live in `src/migrations/` with timestamp prefixes.
2. The `_migrations` collection tracks which migrations have been applied.
3. `up()` applies pending migrations in filename order (oldest first).
4. `down()` reverts the most recent migration.
5. All migrations MUST be idempotent (safe to run twice).

### Creating a new migration

Create a file in `src/migrations/` following this pattern:

```typescript
// src/migrations/20250615140000_add-user-phone-field.ts
import type { Db } from 'mongodb';
import type { IMigration } from '../infrastructure/migration/index.js';

const migration: IMigration = {
  description: 'Add phone field to users collection',

  async up(db: Db): Promise<void> {
    await db.collection('users').updateMany(
      { phone: { $exists: false } },
      { $set: { phone: null } },
    );
  },

  async down(db: Db): Promise<void> {
    await db.collection('users').updateMany(
      {},
      { $unset: { phone: '' } },
    );
  },
};

export default migration;
```

### Included migrations

| File | Description |
| ---- | ----------- |
| `20250101120000_create-user-indexes.ts` | Creates email index, compound role+createdAt index, partial unique email index |
| `20250101120001_create-sessions-collection.ts` | Creates sessions collection with userId+createdAt index and 90-day TTL |

### CI/CD Integration

Run migrations as a separate step before deployment:

```bash
npm run migrate:up && npm start
```

---

## WebSocket (Socket.io)

### Connection (client-side)

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-access-token' },
});

socket.on('connect', () => console.log('Connected'));
socket.on('connect_error', (err) => console.log('Auth failed:', err.message));
```

### Authentication

JWT is verified during the **handshake** — unauthenticated clients are rejected before establishing a WebSocket connection, saving server resources.

### Events

| Event (emit)                | Payload                       | Description                     |
| --------------------------- | ----------------------------- | ------------------------------- |
| `notification:subscribe`   | `{ channel: string }`        | Join a named channel (room)     |
| `notification:unsubscribe` | `{ channel: string }`        | Leave a channel                 |
| `notification:broadcast`   | `{ channel, message }`       | Send message to all in channel  |

| Event (listen)              | Payload                       | Description                     |
| --------------------------- | ----------------------------- | ------------------------------- |
| `notification:subscribed`  | `{ channel }`                 | Confirmation of subscription    |
| `notification:unsubscribed`| `{ channel }`                 | Confirmation of unsubscription  |
| `notification:message`     | `{ channel, message, from, timestamp }` | Incoming broadcast    |

### Controller Pattern

Socket event handlers are organized into controller classes (not inline callbacks):

```
websocket/
├── middleware/socket-auth.middleware.ts   # JWT handshake auth
├── controllers/notification.controller.ts # Event handlers
├── handlers/connection.handler.ts         # Lifecycle orchestration
└── socket.ts                             # Server factory
```

---

## Security Features

| Feature                | Implementation                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| **Security Headers**   | Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)   |
| **CORS**               | Strict origin whitelist, explicit allowed methods/headers            |
| **Rate Limiting**      | Configurable per-IP rate limit (default: 100 req / 15 min)          |
| **Password Hashing**   | Argon2id — 64MB memory, 3 iterations, 4 parallelism (PHC winner)   |
| **JWT Tokens**         | Short access (15m) + long refresh (7d), RS256-ready                 |
| **Token Revocation**   | Redis-backed blacklist with auto-expiry TTL                         |
| **Input Validation**   | Zod schemas on every endpoint, BEFORE reaching the controller       |
| **Error Isolation**    | Operational vs programming errors — no stack traces in production   |
| **Sensitive Redaction** | Pino redacts `authorization`, `cookie`, `password` from logs       |
| **Body Size Limit**    | Express body parser limited to 10KB                                 |
| **Query Injection**    | Mongoose strict mode + Zod type coercion prevent injection          |

---

## Caching Strategy

The service layer implements the **Cache-Aside (Lazy Loading)** pattern:

```
┌──────────┐     cache hit     ┌───────┐
│  Client  │ ────────────────▶ │ Redis │ ──▶ return cached
│          │                   └───────┘
│          │     cache miss    ┌─────────┐     ┌─────────┐
│          │ ────────────────▶ │ MongoDB │ ──▶ │ Redis   │ ──▶ return + cache
└──────────┘                   └─────────┘     │ (write) │
                                               └─────────┘
```

### TTL Strategy

| Data Type         | TTL        | Reasoning                                       |
| ----------------- | ---------- | ----------------------------------------------- |
| User profile      | 5 minutes  | Changes occasionally, stale data = bad UX       |
| Paginated lists   | 1 minute   | Changes frequently (new registrations)           |
| Analytics results | 15 minutes | Expensive aggregations, data changes slowly      |

### Cache Invalidation

- **User update** → invalidate specific user key + all list keys.
- **User deactivation** → invalidate entire user namespace.
- **Pattern invalidation** uses Redis `SCAN` (non-blocking) instead of `KEYS`.

---

## Error Handling Architecture

### Error Hierarchy

```
Error (native)
  └── AppError
        ├── BadRequestError       (400)
        ├── UnauthorizedError     (401)
        ├── ForbiddenError        (403)
        ├── NotFoundError         (404)
        ├── ConflictError         (409)
        ├── ValidationError       (422, includes field-level details)
        └── TooManyRequestsError  (429)
```

### Operational vs Programming Errors

| Type           | Example                  | Response                       | Action         |
| -------------- | ------------------------ | ------------------------------ | -------------- |
| **Operational** | "Email already exists"  | Structured JSON with message   | Log as warn    |
| **Programming** | Null pointer dereference | Generic 500, no details leaked | Log as fatal   |

The global error handler (`error-handler.middleware.ts`) enforces this distinction. Programming errors never expose internals to the client.

---

## Graceful Shutdown

On `SIGINT` or `SIGTERM`, the server shuts down in reverse boot order:

```
Signal received
  │
  ├── 1. Socket.io: stop accepting new connections, close existing sockets
  ├── 2. HTTP server: stop accepting new requests, finish in-flight ones
  ├── 3. MongoDB: close the connection pool
  ├── 4. Redis: close the connection
  │
  └── process.exit(0)
```

`unhandledRejection` and `uncaughtException` are caught, logged as fatal, and trigger `process.exit(1)`.

---

## Testing

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

- **Framework**: Jest + ts-jest
- **HTTP testing**: Supertest (import `createApp()` from `app.ts`)
- **Path aliases**: Mapped in `jest.config.js`
- **Coverage thresholds**: 80% lines, 80% functions, 70% branches

### Testing the Query Store

Query builders are pure functions — test them without a database:

```typescript
import { buildRetentionPipeline } from '@modules/user/queries';

test('retention pipeline starts with $match stage', () => {
  const pipeline = buildRetentionPipeline(new Date(), new Date());
  expect(pipeline[0]).toHaveProperty('$match');
});
```

---

## Code Quality & Git Hooks

### Pre-commit (Husky + lint-staged)

Every commit automatically runs:
1. **ESLint** (with `--fix`) on staged `.ts` files.
2. **Prettier** (with `--write`) on staged `.ts` files.

### ESLint Configuration

- Extends `plugin:@typescript-eslint/strict-type-checked`.
- Enforces `no-floating-promises`, `no-misused-promises`, `strict-boolean-expressions`.
- Enforces import ordering (builtin → external → internal → parent → sibling).
- Enforces naming conventions (interfaces prefixed with `I`, PascalCase types).

### TypeScript Strict Mode

```json
{
  "strict": true,
  "noImplicitAny": true,
  "exactOptionalPropertyTypes": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true
}
```

---

## npm Scripts Reference

| Command                | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `npm run dev`          | Start dev server with hot-reload (tsx watch)      |
| `npm run build`        | Production build (tsup — minified, tree-shaken)   |
| `npm start`            | Run production build                              |
| `npm run lint`         | ESLint check                                      |
| `npm run lint:fix`     | ESLint auto-fix                                   |
| `npm run format`       | Prettier format all source files                  |
| `npm test`             | Run test suite                                    |
| `npm run test:watch`   | Tests in watch mode                               |
| `npm run test:coverage`| Tests with coverage report                        |
| `npm run migrate:up`   | Apply all pending database migrations             |
| `npm run migrate:down` | Revert the last applied migration                 |
| `npm run migrate:status`| Show applied vs pending migration status         |

---

## Horizontal Scaling

### Multi-process deployment

Set `REDIS_URL` in `.env` to enable:

1. **Socket.io Redis Adapter** — WebSocket events broadcast across all processes.
2. **Shared token blacklist** — Logout on one process is enforced on all.
3. **Shared cache** — Cache writes on one process are readable by others.

### Kubernetes / Docker

```bash
# Build
docker build -t microservice .

# Run with migrations
docker run --env-file .env microservice sh -c "npm run migrate:up && npm start"
```

---

## Project Conventions

| Convention                    | Rule                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| **File naming**               | `kebab-case` for all files                                    |
| **Class naming**              | `PascalCase`                                                  |
| **Interface naming**          | Prefixed with `I` (e.g., `IUser`, `IJwtPayload`)             |
| **Barrel exports**            | Every directory has an `index.ts` for clean imports           |
| **Imports**                   | Use `.js` extensions (required for Node16 module resolution)  |
| **Query definitions**         | Always in the Query Store (`queries/`), never inline          |
| **Projections**               | Always use constants from Query Store                         |
| **Read queries**              | Always use `.lean()` for performance                          |
| **Error throwing**            | Always use `AppError` subclasses, never raw `Error`           |
| **Response format**           | Always use `ResponseHelper`, never `res.json()` directly      |
| **Validation**                | Always at the middleware layer via Zod, never in controllers  |
| **Cache TTL**                 | Always explicit, never infinite (`set()` requires TTL param)  |
| **Migrations**                | Always idempotent, timestamped, with `up()` and `down()`      |

---

## License

MIT
# BE_node_clean_code
