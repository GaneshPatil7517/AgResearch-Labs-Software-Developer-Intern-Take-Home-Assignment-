import { DatabasePool, DbClient } from '../db/connection.js';
import { Batch, BatchStage, BatchWithTray } from '../domain/types.js';

export class BatchRepository {
  constructor(private db: DatabasePool) {}

  async create(
    data: {
      tray_id: string;
      crop: string;
      seeded_on: string;
      expected_harvest_on: string;
      stage?: BatchStage;
    },
    client?: DbClient
  ): Promise<Batch> {
    const executor = client || this.db;
    const stage = data.stage || 'SEEDED';
    const query = `
      INSERT INTO batches (tray_id, crop, seeded_on, stage, expected_harvest_on)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at, updated_at;
    `;
    const res = await executor.query<Batch>(query, [
      data.tray_id,
      data.crop,
      data.seeded_on,
      stage,
      data.expected_harvest_on,
    ]);
    return res.rows[0];
  }

  async findActiveBatchByTrayId(
    trayId: string,
    client?: DbClient
  ): Promise<Batch | null> {
    const executor = client || this.db;
    const query = `
      SELECT id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at, updated_at
      FROM batches
      WHERE tray_id = $1 AND stage != 'HARVESTED'
      LIMIT 1;
    `;
    const res = await executor.query<Batch>(query, [trayId]);
    return res.rows[0] || null;
  }

  async findById(id: string, client?: DbClient): Promise<Batch | null> {
    const executor = client || this.db;
    const query = `
      SELECT id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at, updated_at
      FROM batches
      WHERE id = $1;
    `;
    const res = await executor.query<Batch>(query, [id]);
    return res.rows[0] || null;
  }

  async findByIdForUpdate(id: string, client: DbClient): Promise<Batch | null> {
    const query = `
      SELECT id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at, updated_at
      FROM batches
      WHERE id = $1
      FOR UPDATE;
    `;
    const res = await client.query<Batch>(query, [id]);
    return res.rows[0] || null;
  }

  async findByIdWithDetails(id: string): Promise<BatchWithTray | null> {
    const query = `
      SELECT 
        b.id, b.tray_id, b.crop, b.seeded_on, b.stage, b.expected_harvest_on, b.created_at, b.updated_at,
        t.code AS tray_code, t.zone,
        h.id AS harvest_id, h.harvested_on, h.weight_grams, h.grade
      FROM batches b
      JOIN trays t ON b.tray_id = t.id
      LEFT JOIN harvests h ON b.id = h.batch_id
      WHERE b.id = $1;
    `;
    const res = await this.db.query<BatchWithTray>(query, [id]);
    return res.rows[0] || null;
  }

  async updateStage(
    id: string,
    stage: BatchStage,
    client?: DbClient
  ): Promise<Batch> {
    const executor = client || this.db;
    const query = `
      UPDATE batches
      SET stage = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, tray_id, crop, seeded_on, stage, expected_harvest_on, created_at, updated_at;
    `;
    const res = await executor.query<Batch>(query, [stage, id]);
    return res.rows[0];
  }

  async list(params: {
    stage?: BatchStage;
    crop?: string;
    zone?: string;
    limit: number;
    offset: number;
  }): Promise<{ batches: BatchWithTray[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.stage) {
      conditions.push(`b.stage = $${paramIndex++}`);
      values.push(params.stage);
    }

    if (params.crop) {
      conditions.push(`b.crop ILIKE $${paramIndex++}`);
      values.push(`%${params.crop}%`);
    }

    if (params.zone) {
      conditions.push(`t.zone ILIKE $${paramIndex++}`);
      values.push(params.zone);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*)::INT AS total
      FROM batches b
      JOIN trays t ON b.tray_id = t.id
      ${whereClause};
    `;
    const countRes = await this.db.query<{ total: number }>(countQuery, values);
    const total = countRes.rows[0]?.total || 0;

    const dataQuery = `
      SELECT 
        b.id, b.tray_id, b.crop, b.seeded_on, b.stage, b.expected_harvest_on, b.created_at, b.updated_at,
        t.code AS tray_code, t.zone,
        h.id AS harvest_id, h.harvested_on, h.weight_grams, h.grade
      FROM batches b
      JOIN trays t ON b.tray_id = t.id
      LEFT JOIN harvests h ON b.id = h.batch_id
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++};
    `;
    values.push(params.limit, params.offset);

    const dataRes = await this.db.query<BatchWithTray>(dataQuery, values);
    return {
      batches: dataRes.rows,
      total,
    };
  }
}
