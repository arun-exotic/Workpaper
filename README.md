# OBLIQ-in — Mini Audit Document Review System

A prototype for a CA firm audit workflow: create a client, request the
documents an audit needs, have staff upload them, have a reviewer approve or
kick them back for correction, and see the full history of who did what and
when.

**This repository is the backend**, and is where the evaluation time budget
went: workflow logic, data modelling, and — the part the brief calls out as
most important — tenant isolation and audit traceability. `app.enableCors()`
in [`src/main.ts`](src/main.ts) and the Swagger contract at `/docs` make it
straightforward for a frontend to sit on top over HTTPS + JWT, which is
exactly what happened — see [Live demo](#live-demo) below.

## Live demo

| | |
|---|---|
| **Backend API** | https://workpaper.onrender.com ([Swagger UI](https://workpaper.onrender.com/docs)) |
| **Frontend** | https://workpaper-ui.vercel.app |
| **Frontend source** | [github.com/arun-exotic/Workpaper-ui](https://github.com/arun-exotic/Workpaper-ui) |

Both are free-tier deploys, so the backend can take 30–60s to respond on the
first request after a period of inactivity while Render wakes it back up —
not a broken deploy, just a cold start. Demo account credentials are in
[Setup → step 3](#3-run-migrations-and-seed-two-firms) below; the same
accounts work against the live backend.

**On the frontend**: the brief scopes UI as optional, and my first attempt at
one — built in Emergent — looked better than what shipped, but Emergent's
free tier doesn't support publishing a live link, and getting a demo online
mattered more than the extra polish. I rebuilt the UI in v0 against the
[frontend integration doc](docs/FRONTEND_INTEGRATION.md) below, then used
Claude Code to fix bugs (a login button that silently did nothing was the big
one — see that repo's commits) and wire up the file download/activity-feed
features once the backend grew them. All three tools are disclosed in
[AI Tools Used](#ai-tools-used).

## Stack

- **NestJS 11** + **Prisma 6** + **PostgreSQL**
- JWT auth (`@nestjs/jwt` + `passport-jwt`)
- File storage behind a driver interface (`src/storage/`) — local disk for
  dev/tests, [Supabase Storage](#deploying) in the live deploy, swapped by
  one env var

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
Frontend (Next.js on Vercel — github.com/arun-exotic/Workpaper-ui)
   │  HTTPS + JWT (Authorization: Bearer <token>)
   ▼
NestJS controllers   (route + role check via @Roles guard)
   ▼
Services             (state-machine transitions, wrapped in a DB transaction
                       with the AuditEvent they produce)
   ▼
Prisma               (tenant-scoped client extension — every query auto-
                       filtered/force-set by the caller's firmId)
   ▼
PostgreSQL
   ▼
AuditEvent table     (append-only — no update/delete route anywhere, for
                       any role)
```

The frontend is a separate deploy with no privileged access of its own: it
holds a JWT like any other client of this API and gets exactly the access
that token's role allows, enforced entirely on this side of the line.

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
unreachable by every role, including `ADMIN`. `GET /documents/:id/audit-log`,
`GET /clients/:id/audit-log`, and the firm-wide `GET /audit-log` are the only
ways to read it.

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
STORAGE_DRIVER="local"
UPLOAD_DIR="uploads"
```

(`STORAGE_DRIVER` also accepts `"supabase"`, backed by Supabase Storage instead of local disk — see [Deploying](#deploying) below. Local dev and every automated test use `"local"`, so none of this needs real cloud credentials to run.)

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

Or drive the same flow visually from Swagger UI at `/docs`, or from the
[live frontend](#live-demo) — either has "Authorize"/login and every action
above clickable without curl.

> **Screenshots**: the submission brief asks for screenshots in the repo. Add
> a few PNGs of the frontend or Swagger UI flow above to `docs/screenshots/`
> before submitting — none are committed yet.

## Sample data

Picked from the datasets suggested in [`docs/REFERENCE.md`](docs/REFERENCE.md).
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
docs/
  TASK.md              the evaluation brief this repo implements
  REFERENCE.md         evaluator-suggested sample datasets
  FRONTEND_INTEGRATION.md   API contract + suggested screens, for building a UI
  openapi.json         generated OpenAPI spec (mirrors /docs at runtime)
  screenshots/         see the note under "Trying it end-to-end" above
sample-data/
  bank_statement_sample.pdf   see "Sample data" above
```

## Deploying

A live deploy isn't required (the brief accepts "clear instructions to run
locally" on its own), but if you want one: **Render** for the app, **Supabase**
for both Postgres and Storage. Two reasons this split, not one vendor:

- Whatever runs the app needs a database it can reach over the network —
  the local Postgres in the setup above only listens on `localhost`.
- Render's free tier (and most free app-hosting tiers) has no persistent
  disk: the container's filesystem resets on every redeploy and on
  waking from an inactivity-driven spin-down. Local-disk storage would
  silently lose every uploaded file the next time either happens.

Supabase's free tier covers a small managed Postgres *and* a Storage bucket
in the same project, which is what makes the app itself stay fully
stateless — a hard requirement for Render's free tier to actually work here.

1. Create a Supabase project → **Project Settings → Database → Connection
   string**, and use the **Session pooler** URI (port `5432`) for
   `DATABASE_URL` — not "Direct connection" (that hostname is IPv6-only, so
   it's unreachable on plenty of networks/hosts) and not "Transaction
   pooler" (port `6543`; `prisma migrate deploy` hangs against it, since
   transaction-mode pooling doesn't support the session-level advisory
   locks Prisma's migration engine needs). Both gotchas were hit and
   confirmed while verifying this. Also grab **Project Settings → API**'s
   Project URL + `service_role` key for `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY`.
2. In Supabase Storage, create a bucket and set `SUPABASE_BUCKET` to
   its exact name — bucket names are case-sensitive (default assumed here
   is `documents`).
3. Run `npx prisma migrate deploy` against that `DATABASE_URL` once (or let
   Render's start command do it — `start:prod` already runs it before
   booting the app).
4. On Render, create a Web Service from this repo. Build command
   `npm install && npm run build`, start command `npm run start:prod`. Set
   env vars: `DATABASE_URL`, `JWT_SECRET` (a real one — not the dev
   placeholder), `JWT_EXPIRES_IN`, `STORAGE_DRIVER=supabase`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`. Render
   sets `PORT` itself.

## What would I improve with one more week?

**Content validation on uploads.** Storage itself is already abstracted
behind `FileStorageService` (`src/storage/`) — local disk for dev/tests,
Supabase Storage in deployment — so *where* files live isn't the gap
anymore. What's still missing is validating *what's inside* them: right now
any authenticated STAFF/ADMIN can hand the server a size-and-extension-valid
file with arbitrary content, and nothing checks it's actually the PDF/image
it claims to be, let alone scans it. I'd add a MIME-sniffing check (not just
trusting the extension) and a malware scan before persisting — the most
realistic security gap left in the current build.

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

**Claude Code**: Used throughout, for both repos — architecture decisions
(Prisma tenant extension + AsyncLocalStorage request context, document state
machine, transaction-scoped audit writes), all backend source code, the
Prisma schema, seed script, e2e test suite, this README, deployment
troubleshooting (Render + Supabase), and — on the frontend — bug fixes (a
login button that never submitted its form), the file view/download
integration, and the client/firm activity feeds.
**ChatGPT**: Not used.
**Gemini**: Not used.
**Cursor**: Not used.
**GitHub Copilot**: Not used.
**v0**: Generated the frontend's initial Next.js scaffold and screens (login,
client list, client/document detail, review actions) from
[`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md)'s API
contract — see [github.com/arun-exotic/Workpaper-ui](https://github.com/arun-exotic/Workpaper-ui).
**Emergent**: An earlier, further-along frontend attempt — visually ahead of
what shipped — but Emergent's free tier doesn't support publishing a live
link, which cost time before the pivot to v0.

**How AI was used**: For the backend, I described the task (this repo's
[`docs/TASK.md`](docs/TASK.md)) and asked for a NestJS/Prisma/Postgres
backend following the tenant-scoping and guard/interceptor conventions of an
existing production codebase I referenced for architectural consistency.
Claude proposed the Prisma Client extension + AsyncLocalStorage approach for
tenant isolation, the document status state machine, and the
transaction-scoped audit-event pattern; I directed the scope (Postgres, which
patterns to mirror vs. simplify, when to add the real file-storage/Supabase
integration) and reviewed/tested the result end-to-end (manual curl
walkthrough of the full workflow plus cross-firm isolation checks, then a
full e2e test suite, then a live verification pass against the deployed
Render URL) before accepting it.

For the frontend, I wrote the API contract by hand
([`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md)) and gave it
to v0 to generate the UI against; once that was live, I had Claude Code run
it end-to-end in a browser, which is how the broken login button and the
missing file-download UI got caught and fixed, and where the client- and
firm-level activity feeds were added on top of the backend's audit-log
endpoints.
