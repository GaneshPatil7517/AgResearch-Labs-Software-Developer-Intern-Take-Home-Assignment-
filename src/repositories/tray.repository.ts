import { DatabasePool, DbClient } from '../db/connection.js';
import { Tray } from '../domain/types.js';

export class TrayRepository {
  constructor(private db: DatabasePool) {}

  async create(
    data: { code: string; zone: string; capacity_units: number },
    client?: DbClient
  ): Promise<Tray> {
    const executor = client || this.db;
    const query = `
      INSERT INTO trays (code, zone, capacity_units)
      VALUES ($1, $2, $3)
      RETURNING id, code, zone, capacity_units, created_at;
    `;
    const res = await executor.query<Tray>(query, [
      data.code,
      data.zone,
      data.capacity_units,
    ]);
    return res.rows[0];
  }

  async findAll(): Promise<Tray[]> {
    const query = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      ORDER BY created_at ASC;
    `;
    const res = await this.db.query<Tray>(query);
    return res.rows;
  }

  async findById(id: string, client?: DbClient): Promise<Tray | null> {
    const executor = client || this.db;
    const query = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      WHERE id = $1;
    `;
    const res = await executor.query<Tray>(query, [id]);
    return res.rows[0] || null;
  }

  async findByIdForUpdate(id: string, client: DbClient): Promise<Tray | null> {
    const query = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      WHERE id = $1
      FOR UPDATE;
    `;
    const res = await client.query<Tray>(query, [id]);
    return res.rows[0] || null;
  }

  async findByCode(code: string): Promise<Tray | null> {
    const query = `
      SELECT id, code, zone, capacity_units, created_at
      FROM trays
      WHERE code = $1;
    `;
    const res = await this.db.query<Tray>(query, [code]);
    return res.rows[0] || null;
  }
}
