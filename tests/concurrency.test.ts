import { describe, it, expect } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestDatabase } from './test-db.js';
import { buildApp } from '../src/app.js';

describe('Part 3a: Concurrency Safety Tests', () => {
  it('handles two simultaneous requests seeding the same tray: exactly 1 succeeds (201) and 1 fails (409)', async () => {
    const db = await createTestDatabase();
    const app = buildApp({ db, logger: false });
    await app.ready();

    // Create a target tray: T-A-014
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-A-014',
        zone: 'Zone-A',
        capacity_units: 120,
      },
    });
    expect(trayRes.statusCode).toBe(201);
    const trayId = JSON.parse(trayRes.payload).id;

    // Fire 2 concurrent requests at the exact same instant using Promise.all
    const request1 = app.inject({
      method: 'POST',
      url: '/batches',
      payload: {
        tray_id: trayId,
        crop: 'Butterhead Lettuce',
        seeded_on: '2026-09-20',
        expected_harvest_on: '2026-10-15',
      },
    });

    const request2 = app.inject({
      method: 'POST',
      url: '/batches',
      payload: {
        tray_id: trayId,
        crop: 'Tuscan Kale',
        seeded_on: '2026-09-20',
        expected_harvest_on: '2026-10-18',
      },
    });

    const [res1, res2] = await Promise.all([request1, request2]);
    const statusCodes = [res1.statusCode, res2.statusCode].sort();

    // Exactly one 201 Created and exactly one 409 Conflict
    expect(statusCodes).toEqual([201, 409]);

    const conflictResponse = res1.statusCode === 409 ? res1 : res2;
    const successResponse = res1.statusCode === 201 ? res1 : res2;

    const conflictBody = JSON.parse(conflictResponse.payload);
    expect(conflictBody.error).toBe('CONFLICT');
    expect(conflictBody.message).toContain('already has an active batch');

    const successBody = JSON.parse(successResponse.payload);
    expect(successBody.tray_id).toBe(trayId);

    // Verify in database that exactly ONE active batch exists for this tray
    const listRes = await app.inject({
      method: 'GET',
      url: `/batches?zone=Zone-A`,
    });
    const listData = JSON.parse(listRes.payload);
    expect(listData.total).toBe(1);
    expect(listData.data[0].tray_id).toBe(trayId);
  });

  it('handles a burst of 10 simultaneous seeding requests into the same tray with exactly 1 winner', async () => {
    const db = await createTestDatabase();
    const app = buildApp({ db, logger: false });
    await app.ready();

    // Create target tray
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: 'T-BURST-001',
        zone: 'Zone-Burst',
        capacity_units: 100,
      },
    });
    const trayId = JSON.parse(trayRes.payload).id;

    // Fire 10 concurrent requests
    const promises = Array.from({ length: 10 }).map((_, i) =>
      app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: `Crop-${i}`,
          seeded_on: '2026-09-20',
          expected_harvest_on: '2026-10-20',
        },
      })
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.statusCode === 201);
    const conflicts = results.filter((r) => r.statusCode === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(9);

    // Verify all conflicts received standard error payload
    for (const conflict of conflicts) {
      const err = JSON.parse(conflict.payload);
      expect(err.error).toBe('CONFLICT');
      expect(err.message).toContain('already has an active batch');
    }
  });
});
