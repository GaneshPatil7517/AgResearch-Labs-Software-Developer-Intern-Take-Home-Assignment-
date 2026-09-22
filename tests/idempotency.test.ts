import { describe, it, expect } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestDatabase } from './test-db.js';
import { buildApp } from '../src/app.js';

describe('Part 3b: Idempotent Harvest Recording Tests', () => {
  it('returns original harvest result without creating duplicate records when retried with same Idempotency-Key', async () => {
    const db = await createTestDatabase();
    const app = buildApp({ db, logger: false });
    await app.ready();

    // 1. Create Tray and Batch in HARVEST_READY
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-IDEM-01', zone: 'Zone-A', capacity_units: 100 },
    });
    const trayId = JSON.parse(trayRes.payload).id;

    const batchRes = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: {
        tray_id: trayId,
        crop: 'Butterhead Lettuce',
        seeded_on: '2026-09-01',
        expected_harvest_on: '2026-09-28',
      },
    });
    const batchId = JSON.parse(batchRes.payload).id;

    // Advance to HARVEST_READY
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

    const idempotencyKey = 'field-handheld-uuid-98765';
    const harvestPayload = {
      harvested_on: '2026-09-28',
      weight_grams: 1850.5,
      grade: 'A',
    };

    // 2. First Harvest Request (Simulating initial submission from field worker)
    const firstRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: {
        'idempotency-key': idempotencyKey,
      },
      payload: harvestPayload,
    });

    expect(firstRes.statusCode).toBe(201);
    const firstData = JSON.parse(firstRes.payload);
    expect(firstData.harvest.weight_grams).toBe(1850.5);
    expect(firstData.harvest.grade).toBe('A');
    expect(firstData.batch.stage).toBe('HARVESTED');

    // 3. Second Harvest Request (Simulating network retry with the exact same Idempotency-Key)
    const retryRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: {
        'idempotency-key': idempotencyKey,
      },
      payload: harvestPayload,
    });

    // Expect identical 201 response payload, cache HIT header, and isReplayed indicator
    expect(retryRes.statusCode).toBe(201);
    expect(retryRes.headers['x-cache-lookup']).toBe('HIT');
    const retryData = JSON.parse(retryRes.payload);
    expect(retryData.harvest.id).toBe(firstData.harvest.id);
    expect(retryData.harvest.weight_grams).toBe(firstData.harvest.weight_grams);
    expect(retryData.isReplayed).toBe(true);

    // 4. Verify in database that only ONE harvest record was inserted
    const harvestCountRes = await db.query(
      'SELECT COUNT(*)::INT AS count FROM harvests WHERE batch_id = $1;',
      [batchId]
    );
    expect(harvestCountRes.rows[0].count).toBe(1);
  });

  it('rejects retries with the same Idempotency-Key but different request payload with 422 Unprocessable Entity', async () => {
    const db = await createTestDatabase();
    const app = buildApp({ db, logger: false });
    await app.ready();

    // Setup tray and batch in HARVEST_READY
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-IDEM-02', zone: 'Zone-B', capacity_units: 100 },
    });
    const trayId = JSON.parse(trayRes.payload).id;

    const batchRes = await app.inject({
      method: 'POST',
      url: '/batches',
      payload: {
        tray_id: trayId,
        crop: 'Arugula',
        seeded_on: '2026-09-01',
        expected_harvest_on: '2026-09-25',
      },
    });
    const batchId = JSON.parse(batchRes.payload).id;

    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
    await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

    const idempotencyKey = 'field-handheld-uuid-conflict-test';

    // First request
    const firstRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: { 'idempotency-key': idempotencyKey },
      payload: {
        harvested_on: '2026-09-25',
        weight_grams: 1200,
        grade: 'A',
      },
    });
    expect(firstRes.statusCode).toBe(201);

    // Second request with changed weight / payload
    const mismatchedRes = await app.inject({
      method: 'POST',
      url: `/batches/${batchId}/harvest`,
      headers: { 'idempotency-key': idempotencyKey },
      payload: {
        harvested_on: '2026-09-25',
        weight_grams: 1800, // Different weight!
        grade: 'B',
      },
    });

    expect(mismatchedRes.statusCode).toBe(422);
    const err = JSON.parse(mismatchedRes.payload);
    expect(err.error).toBe('UNPROCESSABLE_ENTITY');
    expect(err.message).toContain('different request payload');
  });
});
