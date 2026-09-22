import { DatabasePool } from '../db/connection.js';
import { YieldReportRow } from '../domain/types.js';

export class ReportRepository {
  constructor(private db: DatabasePool) {}

  /**
   * Part 3c: Single SQL query computing yield analytics grouped by crop or zone.
   * Calculates total harvested weight, batch count, and average cycle days (harvested_on - seeded_on).
   */
  async getYieldReport(params: {
    from: string;
    to: string;
    group_by: 'crop' | 'zone';
  }): Promise<YieldReportRow[]> {
    const groupColumn = params.group_by === 'crop' ? 'b.crop' : 't.zone';

    const query = `
      SELECT 
        ${groupColumn} AS group_name,
        COALESCE(SUM(h.weight_grams), 0)::FLOAT AS total_weight_grams,
        COUNT(h.id)::INT AS batch_count,
        ROUND(COALESCE(AVG(h.harvested_on - b.seeded_on), 0)::NUMERIC, 2)::FLOAT AS avg_cycle_days
      FROM harvests h
      JOIN batches b ON h.batch_id = b.id
      JOIN trays t ON b.tray_id = t.id
      WHERE h.harvested_on >= $1 AND h.harvested_on <= $2
      GROUP BY ${groupColumn}
      ORDER BY total_weight_grams DESC, group_name ASC;
    `;

    const res = await this.db.query<YieldReportRow>(query, [params.from, params.to]);
    return res.rows;
  }
}
