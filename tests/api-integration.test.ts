import { describe, it, expect, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestDatabase } from './test-db.js';
import { buildApp } from '../src/app.js';

describe('API Integration & Route Validation Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db = await createTestDatabase();
    app = buildApp({ db, logger: false });
    await app.ready();
  });

  describe('Health Check', () => {
    it('returns 200 OK and healthy status', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.payload);
      expect(data.status).toBe('healthy');
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Tray Endpoints (Part 1)', () => {
    it('POST /trays creates a tray with 201 Created', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: {
          code: 'T-A-001',
          zone: 'Zone-A',
          capacity_units: 150,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.code).toBe('T-A-001');
      expect(body.zone).toBe('Zone-A');
      expect(body.capacity_units).toBe(150);
    });

    it('POST /trays returns 400 Bad Request on invalid payload', async () => {
      // Empty code
      const res1 = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: {
          code: '',
          zone: 'Zone-A',
          capacity_units: 100,
        },
      });
      expect(res1.statusCode).toBe(400);

      // Negative capacity
      const res2 = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: {
          code: 'T-A-002',
          zone: 'Zone-A',
          capacity_units: -5,
        },
      });
      expect(res2.statusCode).toBe(400);
    });

    it('POST /trays returns 409 Conflict on duplicate tray code', async () => {
      await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-A-DUP', zone: 'Zone-A', capacity_units: 100 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-A-DUP', zone: 'Zone-B', capacity_units: 120 },
      });

      expect(res.statusCode).toBe(409);
      const err = JSON.parse(res.payload);
      expect(err.error).toBe('CONFLICT');
      expect(err.message).toContain('already exists');
    });

    it('GET /trays lists all trays', async () => {
      await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-LIST-1', zone: 'Zone-1', capacity_units: 100 },
      });
      await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-LIST-2', zone: 'Zone-2', capacity_units: 200 },
      });

      const res = await app.inject({ method: 'GET', url: '/trays' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.length).toBe(2);
    });

    it('GET /trays/:id returns one tray or 404 Not Found', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-SINGLE', zone: 'Zone-A', capacity_units: 100 },
      });
      const trayId = JSON.parse(createRes.payload).id;

      // Existing tray
      const getRes = await app.inject({
        method: 'GET',
        url: `/trays/${trayId}`,
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.payload).code).toBe('T-SINGLE');

      // Non-existent tray
      const notFoundRes = await app.inject({
        method: 'GET',
        url: '/trays/00000000-0000-0000-0000-000000000000',
      });
      expect(notFoundRes.statusCode).toBe(404);
      expect(JSON.parse(notFoundRes.payload).error).toBe('NOT_FOUND');
    });
  });

  describe('Batch Validation & Filtering (Part 1 & 2)', () => {
    it('POST /batches rejects invalid dates with 400 Bad Request', async () => {
      const trayRes = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-DATE-TEST', zone: 'Zone-A', capacity_units: 100 },
      });
      const trayId = JSON.parse(trayRes.payload).id;

      // expected_harvest_on earlier than seeded_on
      const res = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: trayId,
          crop: 'Kale',
          seeded_on: '2026-10-01',
          expected_harvest_on: '2026-09-01',
        },
      });

      expect(res.statusCode).toBe(400);
      const err = JSON.parse(res.payload);
      expect(err.message).toContain('expected_harvest_on cannot be earlier than seeded_on');
    });

    it('POST /batches returns 404 Not Found when tray_id does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: '11111111-1111-1111-1111-111111111111',
          crop: 'Kale',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-30',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.payload).error).toBe('NOT_FOUND');
    });

    it('GET /batches supports filtering by stage, crop, zone, and pagination', async () => {
      // Create 2 trays in different zones
      const t1 = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-FILTER-1', zone: 'Zone-North', capacity_units: 100 },
      });
      const tray1Id = JSON.parse(t1.payload).id;

      const t2 = await app.inject({
        method: 'POST',
        url: '/trays',
        payload: { code: 'T-FILTER-2', zone: 'Zone-South', capacity_units: 100 },
      });
      const tray2Id = JSON.parse(t2.payload).id;

      // Create 2 batches
      await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: tray1Id,
          crop: 'Butterhead Lettuce',
          seeded_on: '2026-09-01',
          expected_harvest_on: '2026-09-25',
        },
      });

      const b2 = await app.inject({
        method: 'POST',
        url: '/batches',
        payload: {
          tray_id: tray2Id,
          crop: 'Tuscan Kale',
          seeded_on: '2026-09-05',
          expected_harvest_on: '2026-09-30',
        },
      });
      const batch2Id = JSON.parse(b2.payload).id;
      // Advance batch 2 to GERMINATION
      await app.inject({ method: 'PATCH', url: `/batches/${batch2Id}/stage` });

      // Filter by crop
      const cropRes = await app.inject({
        method: 'GET',
        url: '/batches?crop=Lettuce',
      });
      expect(cropRes.statusCode).toBe(200);
      const cropData = JSON.parse(cropRes.payload);
      expect(cropData.total).toBe(1);
      expect(cropData.data[0].crop).toBe('Butterhead Lettuce');

      // Filter by zone
      const zoneRes = await app.inject({
        method: 'GET',
        url: '/batches?zone=Zone-South',
      });
      expect(zoneRes.statusCode).toBe(200);
      const zoneData = JSON.parse(zoneRes.payload);
      expect(zoneData.total).toBe(1);
      expect(zoneData.data[0].crop).toBe('Tuscan Kale');

      // Filter by stage
      const stageRes = await app.inject({
        method: 'GET',
        url: '/batches?stage=GERMINATION',
      });
      expect(stageRes.statusCode).toBe(200);
      const stageData = JSON.parse(stageRes.payload);
      expect(stageData.total).toBe(1);
      expect(stageData.data[0].stage).toBe('GERMINATION');

      // Pagination test: limit=1, offset=0
      const page1Res = await app.inject({
        method: 'GET',
        url: '/batches?limit=1&offset=0',
      });
      expect(page1Res.statusCode).toBe(200);
      const page1Data = JSON.parse(page1Res.payload);
      expect(page1Data.data.length).toBe(1);
      expect(page1Data.total).toBe(2);
      expect(page1Data.limit).toBe(1);
      expect(page1Data.offset).toBe(0);
    });
  });
});
