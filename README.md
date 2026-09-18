# OBLIQ-in — Mini Audit Document Review System (backend)

A backend prototype for a CA firm audit workflow: create a client, request the
documents an audit needs, have staff upload them, have a reviewer approve or
kick them back for correction, and see the full history of who did what and
when.

This submission is **backend-only by design**. The evaluation brief explicitly
scopes UI as optional and this repo focuses the time budget on workflow logic,
data modelling, and — the part the brief calls out as most important —
tenant isolation and audit traceability. A frontend (Lovable/v0) is expected
to sit on top of this API separately; `app.enableCors()` in
[`src/main.ts`](src/main.ts) and the Swagger contract at `/docs` are there to
make that integration straightforward.

## Stack

- **NestJS 11** + **Prisma 6** + **PostgreSQL**
- JWT auth (`@nestjs/jwt` + `passport-jwt`)
- Local disk storage for uploaded files (swappable for S3 later — see "One
  more week")

This mirrors, at a much smaller scale, the NestJS/Prisma/Postgres stack and
tenant-scoping pattern used by a production multi-tenant system I referenced
while designing this (Konnectify's Orchestrator) — see
[Architecture → tenant isolation](#tenant-isolation-how-firm-a-is-kept-out-of-firm-bs-data)
below for the specific pattern and how it's scaled down here.

## Data model

```
Firm (tenant)
 └─ User          (role: STAFF | REVIEWER | ADMIN)
 └─ Client        e.g. "ABC Traders Pvt. Ltd."
     └─ Document  e.g. "Bank Statement"  (status, reviewComment, uploadedBy, filePath)
         └─ AuditEvent[]   (append-only: who, what, when, why)
```

Every model except `Firm` itself carries a `firmId` — see
[`prisma/schema.prisma`](prisma/schema.prisma).

### Document status flow

```
PENDING → UPLOADED → UNDER_REVIEW → APPROVED
                         │
                         └──────→ CORRECTION_REQUIRED → UPLOADED (loop)
```

`UNDER_REVIEW` is its own state (not folded into the approve/reject call) so
the audit trail can show "Aman started reviewing" as a distinct event from
"Aman approved" — matching the granularity in the task brief's example.

## Architecture

```
Frontend (out of scope here — Lovable/v0, calls this API over HTTPS + JWT)
   ↓
NestJS controllers  (route + role check via @Roles guard)
   ↓
Services            (state-machine transitions, wrapped in a DB transaction
                      with the AuditEvent they produce)
   ↓
Prisma (tenant-scoped client extension)
   ↓
PostgreSQL
   ↓
AuditEvent table (append-only, no update/delete route anywhere)
```

### Tenant isolation: how Firm A is kept out of Firm B's data

The brief is explicit that this shouldn't just be "the frontend hides a
button" — so the enforcement point here is the ORM layer, not any individual
controller:

1. **`POST /auth/login`** looks up the user by email (necessarily
   firm-agnostic — the firm isn't known yet), then issues a JWT containing
   `{ sub: userId, firmId, role }`. See [`src/auth/auth.service.ts`](src/auth/auth.service.ts).
2. **`JwtAuthGuard`** verifies the token on every route except
   `POST /auth/login` (see [`src/common/guards/jwt-auth.guard.ts`](src/common/guards/jwt-auth.guard.ts)).
   `JwtStrategy.validate()` re-reads the user from the DB rather than trusting
   the token blindly, so a role change takes effect immediately rather than
   only after the token expires.
3. **`TenantContextInterceptor`** (global) takes the now-verified
   `request.user` and stores `{ firmId, userId, role }` in an
   **`AsyncLocalStorage`** ([`src/common/context/request-context.ts`](src/common/context/request-context.ts))
   for the lifetime of that request — the same request-scoped-context
   technique the production system I referenced uses.
4. **The Prisma tenant extension** ([`src/prisma/tenant.extension.ts`](src/prisma/tenant.extension.ts))
   reads that context on *every* query against `User`, `Client`, `Document`,
   and `AuditEvent`:
   - reads/updates/deletes get `firmId` force-merged into their `where`
     clause,
   - creates get `firmId` force-set from the context, **overwriting**
     anything the caller supplied.

The result: a controller or service method would have to go out of its way
(reach for the unscoped seed/raw client) to leak across firms. A normal typo
— forgetting a `WHERE firmId = ?` — simply cannot happen, because there is no
per-query `WHERE firmId` to forget. Try it yourself:

```bash
# Log in as a Firm A (ABC & Co.) user, then request a Firm B (XYZ & Co.) client id
curl -s http://localhost:3000/clients/<firm-B-client-id> \
  -H "Authorization: Bearer <firm-A-token>"
# → 404 Not Found — not 403. The API never confirms the row exists elsewhere;
#   a cross-firm lookup looks identical to a lookup of a client that was
#   never created.
```

This is also exercised directly in
[`test/audit-workflow.e2e-spec.ts`](test/audit-workflow.e2e-spec.ts).

### Authentication ≠ authorization

Two separate guards, run in this order, make the distinction explicit rather
than folding it into one "is this user allowed" check:

- **`JwtAuthGuard`** — *who are you?* Verifies the signature and expiry.
- **`RolesGuard`** — *are you allowed to do this, given who you are?* Reads
  `@Roles(...)` metadata off the route and checks it against
  `request.user.role`. A `STAFF` user hitting `POST /documents/:id/review`
  gets a `403`, in the backend, regardless of what any frontend renders.

## Roles

| Role | Can |
|---|---|
| **STAFF** | View clients/documents in their firm, upload documents (incl. re-upload after a correction request) |
| **REVIEWER** | Everything STAFF can view, plus start a review, approve, request a correction, view audit history |
| **ADMIN** | Create clients, add required documents to a client's checklist |

Enforced by [`RolesGuard`](src/common/guards/roles.guard.ts) +
[`@Roles()`](src/common/decorators/roles.decorator.ts) on each route — see
[`src/documents/documents.controller.ts`](src/documents/documents.controller.ts)
and [`src/clients/clients.controller.ts`](src/clients/clients.controller.ts).

## Audit trail

Every state-changing action writes an `AuditEvent` row in the **same DB
transaction** as the change it describes (`AuditService.record()`, always
called with the transaction client — see
[`src/audit/audit.service.ts`](src/audit/audit.service.ts)), so an approval
can never exist without the event that says who approved it and when.

There is no `PATCH`/`DELETE` route for `AuditEvent` anywhere in the API, and
no service method that updates or deletes one — once written, an event is
unreachable by every role, including `ADMIN`. `GET /documents/:id/audit-log`
and `GET /clients/:id/audit-log` are the only ways to read it.

Example, from the seeded data:

```
Priya (ADMIN)     DOCUMENT_REQUESTED   Requested "Bank Statement"
Rohit (STAFF)     DOCUMENT_UPLOADED    Uploaded bank_statement.pdf
Aman (REVIEWER)   REVIEW_STARTED
Aman (REVIEWER)   CORRECTION_REQUESTED Page 3 is missing. Please upload the complete bank statement.
Rohit (STAFF)     DOCUMENT_UPLOADED    Uploaded revised document (bank_statement_v2.pdf)
Aman (REVIEWER)   REVIEW_STARTED
Aman (REVIEWER)   DOCUMENT_APPROVED
```

## Setup

### Prerequisites

- Node.js 20+
- A local PostgreSQL server

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the database

Create a database and point `.env` at it:

```bash
createdb audit_workflow
cp .env .env.local   # or just edit .env directly
```

`.env` (already present with sane local defaults):

```
DATABASE_URL="postgresql://postgres@localhost:5432/audit_workflow?schema=public"
JWT_SECRET="dev-only-secret-change-me"
JWT_EXPIRES_IN="8h"
PORT=3000
UPLOAD_DIR="uploads"
```

### 3. Run migrations and seed two firms

```bash
npm run db:migrate
npm run db:seed
```

Seeding creates **two firms** (the brief's minimum for demonstrating
isolation) with one user per role each, plus a sample client and its five
required documents:

| Firm | Role | Email | Password |
|---|---|---|---|
| ABC & Co. | STAFF | rohit@abc.test | password123 |
| ABC & Co. | REVIEWER | aman@abc.test | password123 |
| ABC & Co. | ADMIN | priya@abc.test | password123 |
| XYZ & Co. | STAFF | sanjay@xyz.test | password123 |
| XYZ & Co. | REVIEWER | meera@xyz.test | password123 |
| XYZ & Co. | ADMIN | kavita@xyz.test | password123 |

### 4. Run the API

```bash
npm run start:dev
```

- API: `http://localhost:3000`
- Swagger UI (interactive docs + "Try it out"): `http://localhost:3000/docs`
- OpenAPI spec: [`docs/openapi.json`](docs/openapi.json)

### 5. Run the tests

```bash
npm test           # unit tests
npm run test:e2e   # end-to-end: golden path + tenant isolation + RBAC
```

The e2e suite creates its own two-firm fixture (independent of the seed data)
and, among other things, asserts that a Firm B user gets a `404` for every
Firm A resource — client, document, and audit log — and gets blocked from
uploading against a Firm A document id.

## Trying it end-to-end

```bash
# 1. Log in as ABC & Co.'s staff member
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"rohit@abc.test","password":"password123"}' | jq -r .accessToken)

# 2. See ABC's client and its required documents
curl -s http://localhost:3000/clients -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/clients/1/documents -H "Authorization: Bearer $TOKEN"

# 3. Upload the Bank Statement (document id 1) — using the realistic sample
#    PDF in sample-data/, see "Sample data" below
curl -s -X POST http://localhost:3000/documents/1/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@sample-data/bank_statement_sample.pdf"

# 4. Log in as the reviewer, start review, request a correction
REVIEWER=$(curl -s -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"aman@abc.test","password":"password123"}' | jq -r .accessToken)
curl -s -X POST http://localhost:3000/documents/1/start-review -H "Authorization: Bearer $REVIEWER"
curl -s -X POST http://localhost:3000/documents/1/review -H "Authorization: Bearer $REVIEWER" \
  -H 'Content-Type: application/json' \
  -d '{"action":"REQUEST_CORRECTION","comment":"Page 3 is missing. Please upload the complete bank statement."}'

# 5. Read the full trail
curl -s http://localhost:3000/documents/1/audit-log -H "Authorization: Bearer $TOKEN"
```

Or drive the same flow visually from Swagger UI at `/docs` — it has
"Authorize" (paste the JWT from step 1/4) and "Try it out" on every route, so
the whole workflow above is clickable without curl.

> **Screenshots**: the submission brief asks for screenshots in the repo.
> Add a few PNGs of the Swagger UI flow above (or of the eventual Lovable/v0
> frontend) to `docs/screenshots/` before submitting — none are committed yet.

## Sample data

[`sample-data/bank_statement_sample.pdf`](sample-data/bank_statement_sample.pdf)
is a real (synthetic) 6-page Indian bank statement — file `00001.pdf` from
[AgamiAI/Indian-Bank-Statements](https://huggingface.co/datasets/AgamiAI/Indian-Bank-Statements)
on Hugging Face (Apache-2.0, entirely synthetic data generated for exactly
this kind of testing — no real client/bank information). Used above in
place of a placeholder text file, so an upload actually looks like the
document it claims to be. Already exercised through the full workflow once
in local dev — uploaded as XYZ & Co.'s Bank Statement (document id 6),
reviewed, and approved — but that was a one-off manual run against a running
dev server, not something the seed script itself does; a fresh `npm run
db:seed` leaves document 6 as `PENDING` like every other seeded document.

## Project structure

```
src/
  common/
    context/         AsyncLocalStorage-based per-request tenant context
    decorators/       @Public, @Roles, @CurrentUser
    guards/           JwtAuthGuard (authn), RolesGuard (authz)
    interceptors/      TenantContextInterceptor (bridges JWT → ALS context)
    types/            Express.Request.user augmentation
  prisma/             PrismaService + the tenant-scoping extension
  auth/               Login + JWT strategy
  clients/            Client CRUD (create is ADMIN-only)
  documents/          The core workflow: request/upload/review/approve
  audit/              Append-only AuditEvent read/write
prisma/
  schema.prisma
  seed.ts
test/
  audit-workflow.e2e-spec.ts   golden path + isolation + RBAC
```

## What would I improve with one more week?

**Real object storage and virus scanning for uploads.** Right now files land
on local disk under `uploads/<firmId>/<clientId>/...`, which is fine for a
prototype but wrong for anything that outlives one machine — it doesn't
survive a redeploy, doesn't scale past one instance, and never validates
what's actually inside the file a "staff" account just handed the server.
I'd move to S3 (or R2/GCS) with pre-signed upload URLs, keep only the object
key in `Document.filePath`, and run uploads through a size/MIME/malware check
before they're persisted — closing the most realistic security gap in the
current build (arbitrary file upload from an authenticated-but-untrusted
role).

Close behind that: a `Partner/Admin`-level ability to assign specific clients
to specific staff/reviewers (right now every role sees every client in their
firm, which is fine for a two-person-per-firm demo but wouldn't hold up at a
firm with dozens of clients and staff — "view assigned clients" in the brief
is currently unenforced, just unrestricted-within-firm). I'd add a
`ClientAssignment` join table and scope the `findAll`/`findByClient` queries
through it, which slots into the existing tenant-extension pattern rather
than requiring a new enforcement mechanism.

Third: pagination and filtering on the list/audit-log endpoints, which return
everything unbounded today — harmless at prototype scale, not at real
firm-with-history scale.

## AI Tools Used

**Claude Code**: Used throughout — architecture decisions (Prisma tenant
extension + AsyncLocalStorage request context, document state machine,
transaction-scoped audit writes), all source code, the Prisma schema,
seed script, e2e test suite, and this README.
**ChatGPT**: Not used.
**Gemini**: Not used.
**Cursor**: Not used.
**GitHub Copilot**: Not used.

**How AI was used**: I described the task (this repo's `TASK.md`) and asked
for a NestJS/Prisma/Postgres backend following the tenant-scoping and
guard/interceptor conventions of an existing production codebase I referenced
for architectural consistency. Claude proposed the Prisma Client extension +
AsyncLocalStorage approach for tenant isolation, the document status state
machine, and the transaction-scoped audit-event pattern; I directed the
scope (backend-only, Postgres, which patterns to mirror vs. simplify) and
reviewed/tested the result end-to-end (manual curl walkthrough of the full
workflow plus cross-firm isolation checks, then a full e2e test suite) before
accepting it.
