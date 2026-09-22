import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestDatabase } from './test-db.js';
import { buildApp } from '../src/app.js';

describe('Part 3c: Yield Reporting Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db = await createTestDatabase();
    app = buildApp({ db, logger: false });
    await app.ready();

    // Setup Test Trays
    const t1 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-REPORT-A1', zone: 'Zone-A', capacity_units: 100 },
    });
    const trayA1 = JSON.parse(t1.payload).id;

    const t2 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-REPORT-A2', zone: 'Zone-A', capacity_units: 100 },
    });
    const trayA2 = JSON.parse(t2.payload).id;

    const t3 = await app.inject({
      method: 'POST',
      url: '/trays',
      payload: { code: 'T-REPORT-B1', zone: 'Zone-B', capacity_units: 100 },
    });
    const trayB1 = JSON.parse(t3.payload).id;

    // Helper to seed, advance, and harvest a batch
    async function createAndHarvestBatch(
      trayId: string,
      crop: string,
      seededOn: string,
      harvestedOn: string,
      weightGrams: number,
      grade: 'A' | 'B' | 'C'
    ) {
      const bRes = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop,
          seeded_on: seededOn,
          expected_harvest_on: harvestedOn,
        },
      });
      const batchId = JSON.parse(bRes.payload).id;
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // GROWING
      await app.inject({ method: 'PATCH', url: `/batches/${batchId}/stage` }); // HARVEST_READY

      await app.inject({
        method: 'POST',
        url: `/batches/${batchId}/harvest`,
        payload: {
          harvested_on: harvestedOn,
          weight_grams: weightGrams,
          grade,
        },
      });
    }

    // 1. Butterhead Lettuce (Zone-A): Seeded 2026-08-01, Harvested 2026-08-21 (20 days), Weight 1200g
    await createAndHarvestBatch(trayA1, 'Butterhead Lettuce', '2026-08-01', '2026-08-21', 1200, 'A');

    // 2. Butterhead Lettuce (Zone-A, reused tray): Seeded 2026-08-22, Harvested 2026-09-21 (30 days), Weight 1800g
    await createAndHarvestBatch(trayA1, 'Butterhead Lettuce', '2026-08-22', '2026-09-21', 1800, 'A');

    // 3. Arugula (Zone-A): Seeded 2026-08-10, Harvested 2026-08-30 (20 days), Weight 800g
    await createAndHarvestBatch(trayA2, 'Arugula', '2026-08-10', '2026-08-30', 800, 'B');

    // 4. Tuscan Kale (Zone-B): Seeded 2026-08-05, Harvested 2026-09-04 (30 days), Weight 2500g
    await createAndHarvestBatch(trayB1, 'Tuscan Kale', '2026-08-05', '2026-09-04', 2500, 'A');
  });

  it('aggregates yield report grouped by crop in a single SQL query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-08-01&to=2026-09-30&group_by=crop',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.from).toBe('2026-08-01');
    expect(body.to).toBe('2026-09-30');
    expect(body.group_by).toBe('crop');

    const lettuce = body.data.find((d: any) => d.group_name === 'Butterhead Lettuce');
    expect(lettuce).toBeDefined();
    expect(lettuce.batch_count).toBe(2);
    expect(lettuce.total_weight_grams).toBe(3000); // 1200 + 1800
    expect(lettuce.avg_cycle_days).toBe(25); // (20 + 30) / 2 = 25

    const kale = body.data.find((d: any) => d.group_name === 'Tuscan Kale');
    expect(kale).toBeDefined();
    expect(kale.batch_count).toBe(1);
    expect(kale.total_weight_grams).toBe(2500);
    expect(kale.avg_cycle_days).toBe(30);

    const arugula = body.data.find((d: any) => d.group_name === 'Arugula');
    expect(arugula).toBeDefined();
    expect(arugula.batch_count).toBe(1);
    expect(arugula.total_weight_grams).toBe(800);
    expect(arugula.avg_cycle_days).toBe(20);
  });

  it('aggregates yield report grouped by zone in a single SQL query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-08-01&to=2026-09-30&group_by=zone',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.group_by).toBe('zone');

    const zoneA = body.data.find((d: any) => d.group_name === 'Zone-A');
    expect(zoneA).toBeDefined();
    expect(zoneA.batch_count).toBe(3); // 2 lettuce + 1 arugula
    expect(zoneA.total_weight_grams).toBe(3800); // 1200 + 1800 + 800

    const zoneB = body.data.find((d: any) => d.group_name === 'Zone-B');
    expect(zoneB).toBeDefined();
    expect(zoneB.batch_count).toBe(1);
    expect(zoneB.total_weight_grams).toBe(2500);
  });

  it('filters by date range accurately', async () => {
    // Only records harvested in September (2026-09-01 to 2026-09-30)
    const res = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-09-01&to=2026-09-30&group_by=crop',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // In September: 1 Lettuce (1800g), 1 Kale (2500g). Arugula (harvested Aug 30) excluded.
    const cropNames = body.data.map((d: any) => d.group_name);
    expect(cropNames).toContain('Tuscan Kale');
    expect(cropNames).toContain('Butterhead Lettuce');
    expect(cropNames).not.toContain('Arugula');
  });

  it('validates query parameters and rejects invalid inputs with 400 Bad Request', async () => {
    // Missing 'from'
    const res1 = await app.inject({
      method: 'GET',
      url: '/reports/yield?to=2026-09-30&group_by=crop',
    });
    expect(res1.statusCode).toBe(400);

    // Invalid group_by
    const res2 = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-08-01&to=2026-09-30&group_by=farm',
    });
    expect(res2.statusCode).toBe(400);

    // to date earlier than from date
    const res3 = await app.inject({
      method: 'GET',
      url: '/reports/yield?from=2026-09-30&to=2026-08-01&group_by=crop',
    });
    expect(res3.statusCode).toBe(400);
  });
});
