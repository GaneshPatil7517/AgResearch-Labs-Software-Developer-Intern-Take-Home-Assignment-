import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestDatabase } from './test-db.js';
import { buildApp } from '../src/app.js';

describe('Business Rules Enforcement Tests', () => {
  let app: FastifyInstance;
  let trayId: string;

  beforeEach(async () => {
    const db = await createTestDatabase();
    app = buildApp({ db, logger: false });
    await app.ready();

    // Create a fresh test tray
    const trayRes = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: {
        code: `T-TEST-${Date.now()}`,
        zone: 'Zone-A',
        capacity_units: 100,
      },
    });
    expect(trayRes.statusCode).toBe(201);
    trayId = JSON.parse(trayRes.payload).id;
  });

  /**
   * Business Rule 1:
   * A tray can hold at most one active batch. A batch is active until it reaches HARVESTED.
   */
  describe('Rule 1: Tray single active batch constraint', () => {
    it('allows seeding a batch into an empty tray', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-20',
          expected_harvest_on: '2026-10-15',
        },
      });

      expect(res.statusCode).toBe(201);
      const batch = JSON.parse(res.payload);
      expect(batch.stage).toBe('SEEDED');
      expect(batch.tray_id).toBe(trayId);
    });

    it('rejects seeding a second batch into a tray that has an active batch with 409 Conflict', async () => {
      // Seed first batch
      const firstRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-20',
          expected_harvest_on: '2026-10-15',
        },
      });
      expect(firstRes.statusCode).toBe(201);

      // Attempt second batch while first is active
      const secondRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Arugula',
          seeded_on: '2026-09-21',
          expected_harvest_on: '2026-10-16',
        },
      });

      expect(secondRes.statusCode).toBe(409);
      const err = JSON.parse(secondRes.payload);
      expect(err.error).toBe('CONFLICT');
      expect(err.message).toContain('already has an active batch');
    });

    it('still rejects seeding when active batch is in GERMINATION, GROWING, or HARVEST_READY', async () => {
      const batchRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-20',
          expected_harvest_on: '2026-10-15',
        },
      });
      const batchId = JSON.parse(batchRes.payload).id;

      // Advance to GERMINATION
      await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });

      // Still occupied
      let conflictRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Arugula',
          seeded_on: '2026-09-21',
          expected_harvest_on: '2026-10-16',
        },
      });
      expect(conflictRes.statusCode).toBe(409);

      // Advance to GROWING
      await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });

      conflictRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Kale',
          seeded_on: '2026-09-22',
          expected_harvest_on: '2026-10-18',
        },
      });
      expect(conflictRes.statusCode).toBe(409);
    });
  });

  /**
   * Business Rule 2:
   * Stage transitions only move forward, and only one step at a time.
   * You cannot skip GROWING, and you cannot go back.
   */
  describe('Rule 2: Sequential forward stage transitions', () => {
    it('advances sequentially: SEEDED -> GERMINATION -> GROWING -> HARVEST_READY', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Genovese Basil',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;

      // Step 1: SEEDED -> GERMINATION
      const step1 = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });
      expect(step1.statusCode).toBe(200);
      expect(JSON.parse(step1.payload).stage).toBe('GERMINATION');

      // Step 2: GERMINATION -> GROWING
      const step2 = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });
      expect(step2.statusCode).toBe(200);
      expect(JSON.parse(step2.payload).stage).toBe('GROWING');

      // Step 3: GROWING -> HARVEST_READY
      const step3 = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });
      expect(step3.statusCode).toBe(200);
      expect(JSON.parse(step3.payload).stage).toBe('HARVEST_READY');
    });

    it('rejects skipping a stage (e.g. SEEDED directly to GROWING or HARVEST_READY)', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Genovese Basil',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;

      // Attempt to skip to GROWING
      const skipRes = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
        payload: { stage: 'GROWING' },
      });
      expect(skipRes.statusCode).toBe(409);
      expect(JSON.parse(skipRes.payload).message).toContain('Invalid stage transition');

      // Attempt to skip to HARVEST_READY
      const skipReadyRes = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
        payload: { stage: 'HARVEST_READY' },
      });
      expect(skipReadyRes.statusCode).toBe(409);
    });

    it('rejects backwards stage transitions (e.g. GROWING back to GERMINATION or SEEDED)', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Genovese Basil',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;

      // Advance to GERMINATION then GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // Attempt to go back to GERMINATION
      const backwardRes = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
        payload: { stage: 'GERMINATION' },
      });
      expect(backwardRes.statusCode).toBe(409);

      // Attempt to go back to SEEDED
      const backwardSeededRes = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
        payload: { stage: 'SEEDED' },
      });
      expect(backwardSeededRes.statusCode).toBe(409);
    });

    it('rejects stage advancement once batch is HARVESTED', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Genovese Basil',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;

      // Advance to HARVEST_READY
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

      // Record harvest
      await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-09-30',
          weight_grams: 1200.5,
          grade: 'A',
        },
      });

      // Attempt to advance stage after harvest
      const res = await app.inject({
        method: 'PATCH',
        url: `/batches/${batchId}/stage`,
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.payload).message).toContain('already been harvested');
    });
  });

  /**
   * Business Rule 3:
   * A harvest can only be recorded for a batch in HARVEST_READY.
   */
  describe('Rule 3: Harvest only allowed on HARVEST_READY batches', () => {
    it('rejects harvest on batch in SEEDED stage', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;

      const harvestRes = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-09-30',
          weight_grams: 1500,
          grade: 'A',
        },
      });

      expect(harvestRes.statusCode).toBe(409);
      expect(JSON.parse(harvestRes.payload).message).toContain("Cannot harvest batch in 'SEEDED' stage");
    });

    it('rejects harvest on batch in GERMINATION stage', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION

      const harvestRes = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-09-30',
          weight_grams: 1500,
          grade: 'A',
        },
      });

      expect(harvestRes.statusCode).toBe(409);
      expect(JSON.parse(harvestRes.payload).message).toContain("Cannot harvest batch in 'GERMINATION' stage");
    });

    it('rejects harvest on batch in GROWING stage', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING

      const harvestRes = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-09-30',
          weight_grams: 1500,
          grade: 'A',
        },
      });

      expect(harvestRes.statusCode).toBe(409);
      expect(JSON.parse(harvestRes.payload).message).toContain("Cannot harvest batch in 'GROWING' stage");
    });

    it('successfully records harvest when batch is in HARVEST_READY', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

      const harvestRes = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-09-30',
          weight_grams: 1540.25,
          grade: 'A',
        },
      });

      expect(harvestRes.statusCode).toBe(201);
      const data = JSON.parse(harvestRes.payload);
      expect(data.harvest.batch_id).toBe(batchId);
      expect(data.harvest.weight_grams).toBe(1540.25);
      expect(data.harvest.grade).toBe('A');
      expect(data.batch.stage).toBe('HARVESTED');
    });

    it('rejects recording a second harvest on an already harvested batch', async () => {
      const seedRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batchId = JSON.parse(seedRes.payload).id;
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` });

      // First harvest
      await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-09-30',
          weight_grams: 1540.25,
          grade: 'A',
        },
      });

      // Second harvest attempt
      const secondHarvest = await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: '2026-10-01',
          weight_grams: 1600,
          grade: 'B',
        },
      });

      expect(secondHarvest.statusCode).toBe(409);
      expect(JSON.parse(secondHarvest.payload).message).toContain('already been harvested');
    });
  });

  /**
   * Business Rule 4:
   * Recording a harvest moves the batch to HARVESTED and frees the tray for reuse.
   */
  describe('Rule 4: Harvesting frees tray for reuse', () => {
    it('allows immediately seeding a new batch into the tray after harvest', async () => {
      // 1. Seed Batch 1
      const batch1Res = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Romaine Lettuce',
          seeded_on: '2026-08-01',
          expected_harvest_on: '2026-08-28',
        },
      });
      const batch1Id = JSON.parse(batch1Res.payload).id;

      // 2. Advance Batch 1 through full lifecycle
      await app.inject({ method: 'PATCH', url: `/batches/${batch1Id}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batch1Id}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batch1Id}/stage` }); // HARVEST_READY

      // 3. Harvest Batch 1
      const harvestRes = await app.inject({
        method: 'POST',
        url: `/batches/${batch1Id}/harvest`,
        payload: {
          harvested_on: '2026-08-28',
          weight_grams: 2100,
          grade: 'A',
        },
      });
      expect(harvestRes.statusCode).toBe(201);
      expect(JSON.parse(harvestRes.payload).batch.stage).toBe('HARVESTED');

      // 4. Seed Batch 2 into the exact same tray -> Must succeed with 201 Created!
      const batch2Res = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Baby Spinach',
          seeded_on: '2026-08-29',
          expected_harvest_on: '2026-09-25',
        },
      });

      expect(batch2Res.statusCode).toBe(201);
      const batch2 = JSON.parse(batch2Res.payload);
      expect(batch2.tray_id).toBe(trayId);
      expect(batch2.crop).toBe('Baby Spinach');
      expect(batch2.stage).toBe('SEEDED');
    });
  });
});
