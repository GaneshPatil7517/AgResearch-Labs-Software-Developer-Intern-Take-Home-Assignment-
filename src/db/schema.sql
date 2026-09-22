-- AgResearch Labs Aeroponic Management Schema

-- Trays Table: Physical growing surfaces in facility zones
CREATE TABLE IF NOT EXISTS trays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    zone VARCHAR(50) NOT NULL,
    capacity_units INT NOT NULL CHECK (capacity_units > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Batches Table: Plant batches seeded into trays and tracked through stages
CREATE TABLE IF NOT EXISTS batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tray_id UUID NOT NULL REFERENCES trays(id) ON DELETE RESTRICT,
    crop VARCHAR(100) NOT NULL,
    seeded_on DATE NOT NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'SEEDED' CHECK (stage IN ('SEEDED', 'GERMINATION', 'GROWING', 'HARVEST_READY', 'HARVESTED')),
    expected_harvest_on DATE NOT NULL CHECK (expected_harvest_on >= seeded_on),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Business Rule 1 Enforced at Database Level:
-- A tray can hold at most ONE active batch (any stage other than 'HARVESTED').
-- PostgreSQL Partial Unique Index prevents concurrent or accidental overlapping active batches.
CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_active_tray 
ON batches (tray_id) 
WHERE stage != 'HARVESTED';

-- Indexes for fast filtering on stage, crop, and date
CREATE INDEX IF NOT EXISTS idx_batches_stage ON batches (stage);
CREATE INDEX IF NOT EXISTS idx_batches_crop ON batches (crop);
CREATE INDEX IF NOT EXISTS idx_batches_tray_id ON batches (tray_id);

-- Harvests Table: Recorded harvest events closing out batches
CREATE TABLE IF NOT EXISTS harvests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL UNIQUE REFERENCES batches(id) ON DELETE RESTRICT,
    harvested_on DATE NOT NULL,
    weight_grams NUMERIC(10, 2) NOT NULL CHECK (weight_grams > 0),
    grade VARCHAR(5) NOT NULL CHECK (grade IN ('A', 'B', 'C')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harvests_harvested_on ON harvests (harvested_on);

-- Idempotency Keys Table (Part 3b):
-- Stores response payloads for retried requests on spotty mobile/field connections
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    handler VARCHAR(100) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    response_code INT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys (expires_at);
