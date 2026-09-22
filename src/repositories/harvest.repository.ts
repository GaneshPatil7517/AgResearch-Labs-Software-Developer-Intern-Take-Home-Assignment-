import { DatabasePool, DbClient } from '../db/connection.js';
import { Harvest, HarvestGrade } from '../domain/types.js';

export class HarvestRepository {
  constructor(private db: DatabasePool) {}

  async create(
    data: {
      batch_id: string;
      harvested_on: string;
      weight_grams: number;
      grade: HarvestGrade;
    },
    client?: DbClient
  ): Promise<Harvest> {
    const executor = client || this.db;
    const query = `
      INSERT INTO harvests (batch_id, harvested_on, weight_grams, grade)
      VALUES ($1, $2, $3, $4)
      RETURNING id, batch_id, harvested_on, weight_grams, grade, created_at;
    `;
    const res = await executor.query<Harvest>(query, [
      data.batch_id,
      data.harvested_on,
      data.weight_grams,
      data.grade,
    ]);
    return res.rows[0];
  }

  async findByBatchId(batchId: string, client?: DbClient): Promise<Harvest | null> {
    const executor = client || this.db;
    const query = `
      SELECT id, batch_id, harvested_on, weight_grams, grade, created_at
      FROM harvests
      WHERE batch_id = $1;
    `;
    const res = await executor.query<Harvest>(query, [batchId]);
    return res.rows[0] || null;
  }
}
