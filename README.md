# AgResearch Labs — Aeroponic Batch Tracking API

> REST API built with **Fastify**, **TypeScript**, and **PostgreSQL** to model and track plant batch lifecycles in tray-based aeroponic growing beds.

---

## Table of Contents
1. [Overview & Architecture](#overview--architecture)
2. [Setup & Quickstart](#setup--quickstart)
3. [Business Rules & Lifecycle](#business-rules--lifecycle)
4. [Where Rules Are Enforced (Handler vs Service vs Database)](#where-rules-are-enforced-handler-vs-service-vs-database)
5. [Part 3 Advanced Features](#part-3-advanced-features)
   - [3a. Concurrency Safety & Load Balancer Analysis](#3a-concurrency-safety--load-balancer-analysis)
   - [3b. Idempotent Harvest Recording & TTL Rationale](#3b-idempotent-harvest-recording--ttl-rationale)
   - [3c. Single-Query Yield Reporting](#3c-single-query-yield-reporting)
6. [API Reference & Status Codes](#api-reference--status-codes)
7. [Assumptions](#assumptions)
8. [What We Would Do With More Time](#what-we-would-do-with-more-time)
9. [AI Tooling Disclosure](#ai-tooling-disclosure)

---

## Overview & Architecture

AgResearch Labs (ARL) grows leafy greens in tray-based aeroponic beds. This service tracks physical **Trays**, plant **Batches** progressing through five distinct biological stages, and **Harvest** records.

```
                      +----------------------------------+
                      |         Fastify HTTP API         |
                      |  - Request parsing & Zod schemas |
                      |  - RFC status codes (400,404,409)|
                      +----------------+-----------------+
                                       |
                      +----------------v-----------------+
                      |          Service Layer           |
                      |  - Domain state transitions      |
                      |  - Idempotency hashing & replay  |
                      |  - Transaction orchestration     |
                      +----------------+-----------------+
                                       |
                      +----------------v-----------------+
                      |        Repository Layer          |
                      |  - Row locking (FOR UPDATE)      |
                      |  - Single-query analytics        |
                      +----------------+-----------------+
                                       |
                      +----------------v-----------------+
                      |     PostgreSQL / pg-mem DB       |
                      |  - Partial unique index          |
                      |  - Foreign keys (RESTRICT)       |
                      |  - CHECK constraints             |
                      +----------------------------------+
```

---

## Setup & Quickstart

### Prerequisites
- **Node.js**: v20.x or v22+ (tested on Node v22 and v25)
- **npm**: v10+
- *(Optional)* **Docker & Docker Compose** (for running local PostgreSQL)

### 1. Clone & Install Dependencies
```bash
git clone <your-repo-url>
cd agresearch-labs-assignment
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration:
```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agresearch_db
IDEMPOTENCY_TTL_HOURS=24
```

### 3. Running the Test Suite (Zero-Dependency)
The test suite utilizes `pg-mem` (in-memory PostgreSQL engine executing actual PostgreSQL DDL, constraints, and queries) so **evaluators can run all tests immediately without needing a local PostgreSQL instance running**:
```bash
npm test
```
To run tests in watch mode:
```bash
npm run test:watch
```

### 4. Running with PostgreSQL (Local or Docker)
If you want to run against a real PostgreSQL instance:

**Option A — Using Docker Compose:**
```bash
docker compose up -d
```
*(The schema in `src/db/schema.sql` is automatically mounted and executed upon first startup).*

**Option B — Running Migrations & Seeding Manually:**
```bash
npm run migrate
npm run seed
```

### 5. Start the Application
- **Development mode** (with hot reload):
  ```bash
  npm run dev
  ```
- **Production build**:
  ```bash
  npm run build
  npm start
  ```

---

## Business Rules & Lifecycle

Batches strictly move through the following lifecycle in order:
$$\text{SEEDED} \longrightarrow \text{GERMINATION} \longrightarrow \text{GROWING} \longrightarrow \text{HARVEST\_READY} \longrightarrow \text{HARVESTED}$$

The core business rules enforced by this system are:
1. **Single Active Batch Per Tray**: A tray can hold at most one active batch (any stage $\neq$ `HARVESTED`). Attempting to seed a new batch into an occupied tray returns `409 Conflict`.
2. **Sequential Forward Transitions**: Stage transitions move strictly forward, one step at a time. No skipping stages (e.g., `SEEDED` $\rightarrow$ `GROWING` is prohibited) and no backwards transitions (e.g., `GROWING` $\rightarrow$ `GERMINATION` is prohibited).
3. **Harvest Restricted to HARVEST_READY**: Harvests can only be recorded for batches currently in `HARVEST_READY`. Attempting to harvest batches in earlier stages or already harvested batches returns `409 Conflict`.
4. **Harvest Frees Tray**: Recording a harvest atomically records weight and grade, advances batch stage to `HARVESTED`, and immediately frees the physical tray for new batches.

---

## Where Rules Are Enforced (Handler vs Service vs Database)

In high-reliability agricultural systems, relying on a single layer for validation invites data corruption or race conditions. We adopt a **multi-tiered defensive strategy**:

| Layer | Responsibility | What It Enforces | Rationale |
| :--- | :--- | :--- | :--- |
| **HTTP Handlers** | Boundary & Syntax Validation | Format validation (UUIDs, ISO 8601 dates, non-empty strings, positive numeric limits) via Zod schemas. Translates domain exceptions to RFC HTTP status codes (400, 404, 409, 422). | Rejects malformed requests immediately at the edge without consuming database connections or transaction slots. |
| **Service Layer** | Domain State Machine & Orchestration | State machine transition legality (`SEEDED` $\rightarrow$ `GERMINATION` $\rightarrow$ `GROWING` $\rightarrow$ `HARVEST_READY`), date sanity checks (`expected_harvest_on >= seeded_on`), idempotency key payload hash matching, and transactional unit-of-work demarcation. | Centralizes business logic so it remains reusable across transport protocols (REST, WebSockets, background queues) and provides readable, actionable error messages back to clients. |
| **Database Layer** | Hard Invariant Integrity | 1. **Partial Unique Index**: `CREATE UNIQUE INDEX idx_batches_active_tray ON batches (tray_id) WHERE stage != 'HARVESTED';`<br>2. **Foreign Keys**: `ON DELETE RESTRICT`<br>3. **CHECK Constraints**: `stage IN (...)`, `grade IN (...)`, `weight_grams > 0`<br>4. **Row-Level Locking**: `SELECT ... FOR UPDATE` | **The ultimate source of truth.** Prevents concurrency race conditions, database corruption, or bypasses by external tools/scripts. |

---

## Part 3 Advanced Features

### 3a. Concurrency Safety & Load Balancer Analysis

#### The Problem
Two concurrent HTTP requests arrive at the exact same millisecond attempting to seed a batch into tray `T-A-014`.

#### The Solution
We protect against race conditions using a two-tier database strategy:
1. **Row-Level Pessimistic Locking**: Inside the seeding transaction, we execute `SELECT id FROM trays WHERE id = $1 FOR UPDATE`. The first transaction acquires an exclusive row lock on the tray. The second concurrent transaction blocks until the first completes.
2. **Partial Unique Index Safeguard**:
   ```sql
   CREATE UNIQUE INDEX idx_batches_active_tray 
   ON batches (tray_id) 
   WHERE stage != 'HARVESTED';
   ```
   Even if an isolation anomaly or bypass occurred, the database engine guarantees that at most one row with `stage != 'HARVESTED'` can exist per `tray_id`. The second transaction catches PostgreSQL error code `23505` (unique violation) and cleanly translates it to a `409 Conflict`.

#### What Happens Behind a Multi-Instance Load Balancer?
If 5 or 50 copies of the API run behind an AWS ALB or Nginx load balancer:
- Each API node is stateless.
- Row locks and partial unique indexes are managed centrally inside PostgreSQL's write-ahead log (WAL) and B-tree index catalog.
- The PostgreSQL lock manager guarantees that across all distributed connections, exactly one transaction will commit the new active batch.
- The concurrent worker on another node receives a clean `409 Conflict` response with payload:
  ```json
  {
    "error": "CONFLICT",
    "message": "Tray 'T-A-014' already has an active batch",
    "statusCode": 409
  }
  ```

#### Automated Verification
`tests/concurrency.test.ts` fires genuine concurrent `Promise.all` requests (and 10-request bursts) against the same tray, proving that exactly 1 succeeds (201) and all others fail cleanly (409).

---

### 3b. Idempotent Harvest Recording & TTL Rationale

#### The Problem
Field workers logging harvest yields on mobile handhelds often experience intermittent Wi-Fi/cellular drops. When a connection drops during request transit, the client retries the request. Without idempotency, this could record duplicate harvests or return false conflict errors.

#### The Implementation
- The client sends an `Idempotency-Key: <unique-uuid>` header with `POST /batches/:id/harvest`.
- On request receipt, the service computes a SHA-256 fingerprint of the request payload (`batchId + harvested_on + weight_grams + grade`).
- If an existing active key is found:
  - **Identical Payload**: Returns the stored `201` response with headers `X-Cache-Lookup: HIT` and `{ isReplayed: true }` without touching the harvest records table or advancing state.
  - **Mismatched Payload**: Detects key collision/tampering and returns `422 Unprocessable Entity` ("Idempotency-Key was previously used with a different request payload").

```sql
CREATE TABLE idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    handler VARCHAR(100) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response_code INT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
```

#### TTL Rationale: Why 24 Hours?
1. **Operational Shift Alignment**: Farm harvesting rounds occur on single-day or shift cycles. A 24-hour validity window gives devices ample time to reconnect and flush offline retry queues.
2. **Storage Boundedness**: Storing idempotency records indefinitely creates unbounded table bloat. Expired keys can be vacuumed safely after 24 hours via scheduled cron jobs without affecting past harvest analytics.

---

### 3c. Single-Query Yield Reporting

#### Endpoint
`GET /reports/yield?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=crop|zone`

#### Single SQL Query
```sql
SELECT 
  b.crop AS group_name, -- or t.zone dynamically based on group_by
  COALESCE(SUM(h.weight_grams), 0)::FLOAT AS total_weight_grams,
  COUNT(h.id)::INT AS batch_count,
  ROUND(COALESCE(AVG(h.harvested_on - b.seeded_on), 0)::NUMERIC, 2)::FLOAT AS avg_cycle_days
FROM harvests h
JOIN batches b ON h.batch_id = b.id
JOIN trays t ON b.tray_id = t.id
WHERE h.harvested_on >= $1 AND h.harvested_on <= $2
GROUP BY b.crop -- or t.zone
ORDER BY total_weight_grams DESC, group_name ASC;
```

#### Query Breakdown & Walkthrough
1. **Inner Joins**: `harvests` $\rightarrow$ `batches` $\rightarrow$ `trays` links each harvest event with its crop type and physical tray zone.
2. **Date Difference Arithmetic**: `h.harvested_on - b.seeded_on` computes the exact number of days the batch spent in the aeroponic system from seeding to harvest.
3. **Aggregate Functions**:
   - `SUM(h.weight_grams)` aggregates total yield in grams.
   - `COUNT(h.id)` counts the number of batches harvested in the date window.
   - `AVG(...)` computes the average growth cycle in days, rounded to 2 decimal places.
4. **Single Roundtrip**: No $N+1$ queries or application-level looping. Indexes on `harvests(harvested_on)`, `batches(tray_id)`, and `batches(crop)` ensure $O(\log N)$ scan efficiency.

---

## API Reference & Status Codes

| Endpoint | Method | Status Codes | Description |
| :--- | :--- | :--- | :--- |
| `/trays` | `POST` | `201`, `400`, `409` | Create a new tray (`code`, `zone`, `capacity_units`). |
| `/trays` | `GET` | `200` | List all trays. |
| `/trays/:id` | `GET` | `200`, `404` | Get single tray by ID. |
| `/batches` | `POST` | `201`, `400`, `404`, `409` | Seed a new batch into a tray (`tray_id`, `crop`, `seeded_on`, `expected_harvest_on`). |
| `/batches` | `GET` | `200`, `400` | List batches with filtering (`stage`, `crop`, `zone`) and pagination (`limit`, `offset`). |
| `/batches/:id` | `GET` | `200`, `404` | Get single batch with tray and harvest details. |
| `/batches/:id/stage` | `PATCH` | `200`, `400`, `404`, `409` | Advance batch stage sequentially. |
| `/batches/:id/harvest` | `POST` | `201`, `200` *(replay)*, `400`, `404`, `409`, `422` | Record harvest (`harvested_on`, `weight_grams`, `grade`) and close batch. Supports `Idempotency-Key`. |
| `/reports/yield` | `GET` | `200`, `400` | Yield report grouped by `crop` or `zone` across date range. |
| `/health` | `GET` | `200` | Service health status. |

---

## Assumptions

Here are the deliberate engineering decisions made to resolve gaps in the specification:

1. **Tray Code Uniqueness**: Tray codes (e.g. `"T-A-014"`) are enforced unique across the facility to prevent ambiguous physical tray references.
2. **Stage Progression Semantics for PATCH `/batches/:id/stage`**:
   - The endpoint accepts an optional `{ "stage": "..." }` body.
   - If provided, the requested stage is strictly verified to match the next sequential state in the lifecycle.
   - If omitted, the service automatically advances the batch to the next sequential stage.
   - Advancing past `HARVEST_READY` cannot be done via `/stage`; it must be executed via `POST /batches/:id/harvest` so weight and grade are captured.
3. **Date Formats & Ordering**:
   - Dates are formatted as ISO 8601 calendar strings (`YYYY-MM-DD`).
   - The validation layer enforces that `expected_harvest_on >= seeded_on` and `harvested_on >= seeded_on`.
4. **Capacity Units & Yield Metrics**:
   - `capacity_units` is validated as a positive integer ($> 0$).
   - `weight_grams` is validated as a positive floating-point number ($> 0$).
   - `grade` is strictly validated to one of `'A'`, `'B'`, or `'C'`.
5. **Pagination & Query Defaults**:
   - `GET /batches` defaults to `limit=20` (max 100) and `offset=0`.
   - `crop` search performs a case-insensitive substring match (`ILIKE %query%`), while `zone` matches the zone identifier.
6. **Error Response Format**:
   - All errors follow a standard JSON shape:
     ```json
     {
       "error": "CONFLICT",
       "message": "Human readable explanation",
       "statusCode": 409
     }
     ```

---

## What We Would Do With More Time

1. **Change Data Capture (CDC) / Event Sourcing**:
   - Publish domain events (`BatchSeeded`, `StageAdvanced`, `HarvestRecorded`) to an Apache Kafka or AWS SNS/SQS event bus to integrate with automated LED lighting controllers, aeroponic misting nozzles, and ERP systems.
2. **Sensor Telemetry Ingestion**:
   - Add time-series tables (or TimescaleDB) to correlate batch yields with temperature, pH, electrical conductivity (EC), and humidity time-series readings.
3. **Soft Deletes & Comprehensive Audit Trail**:
   - Add audit logging tables capturing user IDs, timestamps, and previous state snapshots for compliance with agricultural food safety standards (e.g., GAP/HACCP).
4. **Idempotency Cleanup Worker**:
   - Add a lightweight background worker or pg_cron job to purge expired idempotency keys past their 24-hour TTL window.

---

## AI Tooling Disclosure

In accordance with the assignment guidelines:
- **AI Tools Used**: Google Antigravity / Gemini 3.1 Pro.
- **Where Applied**:
  - Scaffolding repetitive boilerplate for Fastify route handlers and Zod schemas.
  - Designing the test fixtures for concurrency and idempotency simulation.
  - Formulating the single-query SQL aggregation for Part 3c yield reporting.
- **Human Verification**: All code, database schemas, constraint definitions, and architectural decisions were reviewed, verified, and validated against the business rules and test suite.
