# Frontend integration guide

Everything a frontend (Lovable, v0, or hand-written) needs to build a UI
against this backend: base URL, auth flow, every endpoint with exact
request/response shapes, the enums, and a suggested screen breakdown. This
API is fully documented in `docs/openapi.json` / the live Swagger UI at
`/docs` too — this doc exists because those are harder to paste into an AI
UI builder's prompt than a plain markdown reference.

Nothing here needs to be re-derived from the backend source — if the API
changes, this file and `docs/openapi.json` should change with it.

## Base URL & running the API

- Local dev: `http://localhost:3000` (`npm run start:dev` in the backend repo)
- CORS is already open (`app.enableCors()` in `src/main.ts`) — a frontend
  hosted on a different origin (Lovable/v0 preview domain, Vercel, etc.) can
  call this API directly with no proxy.
- Swagger UI: `http://localhost:3000/docs` — has "Authorize" + "Try it out"
  on every route, useful for checking a response shape live while building.

## Auth

**`POST /auth/login`** — the only endpoint that doesn't require a token.

Request:
```json
{ "email": "rohit@abc.test", "password": "password123" }
```

Response `200`:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 2,
    "name": "Rohit",
    "email": "rohit@abc.test",
    "role": "STAFF",
    "firmId": 1
  }
}
```

Response `401` (wrong email/password):
```json
{ "message": "Invalid email or password", "error": "Unauthorized", "statusCode": 401 }
```

Every other request must carry the token:
```
Authorization: Bearer <accessToken>
```

Tokens expire after 8 hours (`JWT_EXPIRES_IN`). There's no refresh endpoint
in this prototype — on a `401`, send the user back to login.

### Seeded accounts for building against

Two firms, three roles each, all seeded with password `password123` (dev-only
seed data, not real credentials):

| Firm | Role | Email |
|---|---|---|
| ABC & Co. | STAFF | `rohit@abc.test` |
| ABC & Co. | REVIEWER | `aman@abc.test` |
| ABC & Co. | ADMIN | `priya@abc.test` |
| XYZ & Co. | STAFF | `sanjay@xyz.test` |
| XYZ & Co. | REVIEWER | `meera@xyz.test` |
| XYZ & Co. | ADMIN | `kavita@xyz.test` |

Log in as two different firms' users to see tenant isolation for yourself —
ABC's token will never return XYZ's clients/documents, and vice versa.

## Roles → what the UI should show

The backend enforces every one of these independently of the UI (a `403` comes
back if you call something the role can't do) — but the UI should hide
controls the current user can't use rather than showing a button that always
errors:

| Role | Can do |
|---|---|
| **ADMIN** | Create a client, add a required document to a client's checklist |
| **STAFF** | View clients/documents, upload a document (incl. re-upload after correction) |
| **REVIEWER** | View clients/documents, start a review, approve, request a correction, view audit history |
| *(all roles)* | View clients, view documents, view audit history |

`user.role` from the login response is what you branch the UI on.

## Data model (what the UI will render)

```ts
type Role = 'STAFF' | 'REVIEWER' | 'ADMIN';

type DocumentStatus =
  | 'PENDING'             // requested, nothing uploaded yet
  | 'UPLOADED'            // staff uploaded, waiting for a reviewer to start
  | 'UNDER_REVIEW'        // reviewer opened it
  | 'APPROVED'            // terminal — no further action possible
  | 'CORRECTION_REQUIRED'; // reviewer sent it back with reviewComment set

type AuditAction =
  | 'CLIENT_CREATED'
  | 'DOCUMENT_REQUESTED'
  | 'DOCUMENT_UPLOADED'
  | 'REVIEW_STARTED'
  | 'DOCUMENT_APPROVED'
  | 'CORRECTION_REQUESTED';

interface Client {
  id: number;
  firmId: number;
  name: string;
  createdAt: string; // ISO 8601
  documents?: Document[]; // present on GET /clients/:id only
}

interface Document {
  id: number;
  firmId: number;
  clientId: number;
  name: string; // e.g. "Bank Statement"
  status: DocumentStatus;
  filePath: string | null;         // relative path on the server, not a public URL
  fileOriginalName: string | null; // what to show the user, e.g. "bank_statement.pdf"
  uploadedById: number | null;
  uploadedAt: string | null;
  reviewComment: string | null; // set when CORRECTION_REQUIRED, null otherwise
  createdAt: string;
  updatedAt: string;
  // present on GET /documents/:id only:
  client?: { id: number; name: string };
  uploadedBy?: { id: number; name: string; role: Role };
}

interface AuditEvent {
  id: number;
  firmId: number;
  clientId: number;
  documentId: number | null; // null for client-level events (CLIENT_CREATED)
  actorId: number;
  action: AuditAction;
  comment: string | null;
  createdAt: string;
  actor: { id: number; name: string; role: Role };
  document?: { id: number; name: string }; // only on the client-level audit-log endpoint
}
```

There is no direct file-download endpoint in this prototype — `filePath` is
a server-relative disk path, not a servable URL. If the mock UI needs an
"open the uploaded file" affordance, treat it as a placeholder (e.g. show
`fileOriginalName` with a disabled/mock download button) rather than wiring
it to `filePath` directly.

## Endpoints

All paths below are relative to the base URL. All (except login) require
`Authorization: Bearer <token>`.

### `POST /auth/login`
See [Auth](#auth) above. No token required.

### `POST /clients` — ADMIN only
Create a client.

Request:
```json
{ "name": "ABC Traders Pvt. Ltd." }
```
Response `201`: the created `Client` (no `documents` field on create).
`403` if caller isn't ADMIN.

### `GET /clients`
List every client in the caller's firm (never another firm's — enforced
server-side, not just filtered in the UI).

Response `200`: `Client[]` (no `documents` field on the list view).

### `GET /clients/:id`
One client with its documents.

Response `200`: `Client` with `documents: Document[]` populated.
`404` if the id doesn't exist **or belongs to another firm** — the API
deliberately doesn't distinguish the two, so don't build a UI that assumes
a 404 always means "typo'd the id."

### `POST /clients/:clientId/documents` — ADMIN only
Add a required document to a client's checklist. This does **not** accept a
file — it just creates the `PENDING` placeholder that staff will later
upload against.

Request:
```json
{ "name": "Bank Statement" }
```
Response `201`: the created `Document`, `status: "PENDING"`.

### `GET /clients/:clientId/documents`
List a client's documents (their required-document checklist with current
status).

Response `200`: `Document[]`.

### `GET /documents/:id`
Full detail for one document — the "review" screen's main data source.

Response `200`: `Document` with `client` and `uploadedBy` populated.
`404` for a cross-firm id, same rule as clients.

### `POST /documents/:id/upload` — STAFF or ADMIN
Staff uploads (or re-uploads after a correction request). **Multipart
form-data**, not JSON — field name must be `file`.

```
Content-Type: multipart/form-data
file: <binary>
```

Response `200`: the updated `Document`, `status: "UPLOADED"`.
`400` if the document is already `APPROVED` or currently `UNDER_REVIEW`
(re-upload isn't allowed in either state) — show the error message from the
response body, it's written to be shown to a user:
```json
{ "message": "Document is already approved and cannot be re-uploaded", "error": "Bad Request", "statusCode": 400 }
```
`413` if the file is over 10MB:
```json
{ "message": "File too large", "error": "Payload Too Large", "statusCode": 413 }
```

### `POST /documents/:id/start-review` — REVIEWER only
Moves `UPLOADED` → `UNDER_REVIEW`. No request body.

Response `200`: the updated `Document`.
`400` if the document isn't currently `UPLOADED`.

### `POST /documents/:id/review` — REVIEWER only
The approve/reject decision. Only valid when the document is
`UNDER_REVIEW`.

Request (approve):
```json
{ "action": "APPROVE" }
```
Request (request correction — `comment` is required in this case, minimum 3
characters):
```json
{ "action": "REQUEST_CORRECTION", "comment": "Page 3 is missing. Please upload the complete bank statement." }
```
Response `200`: the updated `Document` — `status` becomes `APPROVED`
(`reviewComment` cleared to `null`) or `CORRECTION_REQUIRED`
(`reviewComment` set to what was sent).
`400` if `action` is `REQUEST_CORRECTION` and `comment` is missing/too
short, or if the document isn't `UNDER_REVIEW`.

### `GET /documents/:id/audit-log`
Full history for one document, oldest first — this is the "audit trail"
panel on the document detail screen.

Response `200`: `AuditEvent[]`, each with `actor` populated (no `document`
field — you already know which document, it's the one you asked for).

### `GET /clients/:clientId/audit-log`
Full history for every document under a client, oldest first — a
client-wide activity feed.

Response `200`: `AuditEvent[]`, each with `actor` and `document` populated.

## Document status → allowed actions (drive your buttons off this)

```
PENDING
  → STAFF: upload
UPLOADED
  → STAFF: upload (re-upload before review starts)
  → REVIEWER: start-review
UNDER_REVIEW
  → REVIEWER: review (APPROVE or REQUEST_CORRECTION)
  (upload is blocked here for everyone)
CORRECTION_REQUIRED
  → STAFF: upload  (shows reviewComment as the reason)
APPROVED
  (terminal — no actions from anyone)
```

## Suggested screens

A minimal mock UI covering the whole brief needs roughly:

1. **Login** — email + password → store `accessToken` + `user` (role drives
   what renders everywhere else).
2. **Client list** (`GET /clients`) — name + created date; "New Client"
   button visible only for ADMIN, opens a form posting to `POST /clients`.
3. **Client detail** (`GET /clients/:id`) — client name, then its documents
   as a table/list: name, status (badge), uploaded-by, last updated. "Add
   required document" button (ADMIN only) → `POST /clients/:clientId/documents`.
   A link per document into the document detail screen.
4. **Document detail** (`GET /documents/:id`) — name, client, uploaded-by,
   uploaded-at, status, `reviewComment` (shown prominently when
   `CORRECTION_REQUIRED`). Action buttons depend on role + status per the
   table above: file picker + "Upload" (STAFF), "Start Review" (REVIEWER,
   when `UPLOADED`), "Approve" / "Request Correction" (REVIEWER, when
   `UNDER_REVIEW` — correction opens a comment field). Below that, the audit
   trail (`GET /documents/:id/audit-log`) rendered as a timeline: actor,
   role, action, timestamp, comment.
5. **(optional) Firm-wide activity feed** — `GET /clients/:clientId/audit-log`
   rendered the same way, for a client-level view instead of per-document.

That's the whole brief's workflow in five screens plus login.

## Errors, generically

Every error response has the same shape (Nest's default `HttpException`
body):
```json
{ "message": "...", "error": "...", "statusCode": 400 }
```
`message` is written to be shown directly to a user for `400`s; for `401`/
`403`/`404` a generic "please sign in again" / "you don't have access" /
"not found" in the UI is fine — don't rely on the exact text of those for
anything beyond a status-code check.

