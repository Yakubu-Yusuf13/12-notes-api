# Notes API

A REST API built with Node.js 20, Express 5, and Neon Postgres. Authentication uses bcryptjs and signed JWT bearer tokens.

## Requirements

- Node.js 20 or later
- A Neon account and Postgres project
- VS Code REST Client extension (optional, for `requests.http`)

## Setup

1. In Neon, create a project and copy its **pooled** connection string.
2. In the Neon SQL Editor, run [`db/schema.sql`](./db/schema.sql) to create the `users` and `notes` tables.
3. Copy `.env.example` to `.env`, then set the values:

   ```dotenv
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
   JWT_SECRET=your-random-secret-at-least-32-characters-long
   PORT=3000
   ```

   Generate a JWT secret locally with:

   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Keep `.env` private; it is ignored by Git. Never commit or share the database URL or JWT secret.

4. Install dependencies and start the API:

   ```sh
   npm ci
   npm run dev
   ```

   The server listens on port `3000` by default. Check the database connection at `GET http://localhost:3000/api/health`.
5. Open [`requests.http`](./requests.http) in VS Code and send requests in order. Change the example email addresses before registering again; the register and login requests capture a token for the later requests.

## Endpoints

All responses are JSON except successful note deletion (`204 No Content`). Validation failures return `422`; errors use `{ "error": { "message": "...", "details": [...] } }` where details are available.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Check API and database connectivity |
| `POST` | `/api/auth/register` | No | Create an account and return `{ user, token }` |
| `POST` | `/api/auth/login` | No | Authenticate and return `{ token, user }` |
| `GET` | `/api/auth/me` | Bearer token | Return the authenticated user |
| `GET` | `/api/notes` | Bearer token | List only the caller's notes; supports `q`, `tag`, `pinned`, `page`, and `limit` |
| `POST` | `/api/notes` | Bearer token | Create a note for the caller |
| `GET` | `/api/notes/:id` | Bearer token | Get one of the caller's notes |
| `PATCH` | `/api/notes/:id` | Bearer token | Update one of the caller's notes |
| `DELETE` | `/api/notes/:id` | Bearer token | Delete one of the caller's notes |

Auth routes are limited to 10 requests per IP per 15 minutes. Notes endpoints require `Authorization: Bearer <token>`. Requests to a note that does not belong to the caller return `404`, the same as a nonexistent note, so the API does not disclose another user's note existence.

## Authentication flow

```mermaid
sequenceDiagram
    actor Client
    participant API
    participant DB as Neon Postgres

    Client->>API: POST /api/auth/register or /api/auth/login
    API->>DB: Find/create user (store bcrypt password hash)
    DB-->>API: User record (hash excluded from response)
    API-->>Client: User and signed JWT (expires in 1 hour)
    Client->>API: Request with Authorization: Bearer <token>
    API->>API: Verify HS256 signature and expiration
    API->>DB: Query using authenticated user ID
    DB-->>API: User-scoped result
    API-->>Client: JSON response
```

## Tests and Neon test branch

The integration tests use a **separate Neon branch** so test accounts and notes cannot modify the development or production branch. Neon branches are isolated database branches that can be created quickly from a parent branch. A branch normally starts from a snapshot of its parent; keep test data synthetic and do not use a production connection URL for tests.

1. In the Neon console, create a dedicated branch such as `swd-notes-api-test`. Copy that branch's pooled connection string and run [`db/schema.sql`](./db/schema.sql) on it if the tables are not present.
2. Set `TEST_DATABASE_URL` to that branch's pooled connection string in the shell that will run tests. For PowerShell:

   ```powershell
   $env:TEST_DATABASE_URL = "postgresql://USER:PASSWORD@TEST-BRANCH-HOST/neondb?sslmode=require"
   npm test
   Remove-Item Env:TEST_DATABASE_URL
   ```

   The tests reject a `TEST_DATABASE_URL` identical to `DATABASE_URL`, set a test-only JWT secret, generate unique test accounts, and delete those accounts afterward. Do not point `TEST_DATABASE_URL` at production.
3. Run `npm test`. The suite covers registration/login/me, missing/garbled/expired bearer tokens, and cross-user note read/update/delete/list isolation.

Tests require the test branch to be reachable and have the schema applied; they intentionally fail with an actionable message if `TEST_DATABASE_URL` is unset.

## Security

- Environment configuration is validated at startup; secrets and `.env.test` are ignored by Git.
- Passwords are hashed with bcryptjs (cost 12) and never returned by API responses.
- JWTs are signed with HS256, expire after one hour, and contain only the user ID subject. A JWT is signed, not encrypted, so its payload is readable; never put passwords, hashes, secrets, or sensitive personal data in it.
- Protected routes verify the bearer token and restrict accepted JWT algorithms to HS256.
- Every notes read, update, and delete is scoped to the authenticated user; note ownership is set from the token when creating.
- SQL uses parameterized Neon tagged-template queries; dynamic list filters are composed as SQL fragments rather than concatenated into query strings.
- Request bodies and query/path parameters are validated with Zod; JSON bodies are limited to 100 KB.
- Helmet security headers, a restricted local CORS allowlist, and auth-route rate limiting are enabled.
- Production errors return generic server messages rather than stack traces or SQL details.
