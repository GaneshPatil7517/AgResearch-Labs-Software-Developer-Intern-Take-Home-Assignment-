import { DatabasePool, DbClient } from '../db/connection.js';
import { IdempotencyRecord } from '../domain/types.js';

export class IdempotencyRepository {
  constructor(private db: DatabasePool) {}

  async find(
    key: string,
    handler: string,
    client?: DbClient
  ): Promise<IdempotencyRecord | null> {
    const executor = client || this.db;
    const query = `
      SELECT key, handler, request_hash, response_code, response_body, created_at, expires_at
      FROM idempotency_keys
      WHERE key = $1 AND handler = $2 AND expires_at > NOW();
    `;
    const res = await executor.query<IdempotencyRecord>(query, [key, handler]);
    return res.rows[0] || null;
  }

  async save(
    record: {
      key: string;
      handler: string;
      request_hash: string;
      response_code: number;
      response_body: unknown;
      expires_at: Date;
    },
    client?: DbClient
  ): Promise<void> {
    const executor = client || this.db;
    const query = `
      INSERT INTO idempotency_keys (key, handler, request_hash, response_code, response_body, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (key) DO UPDATE
      SET handler = EXCLUDED.handler,
          request_hash = EXCLUDED.request_hash,
          response_code = EXCLUDED.response_code,
          response_body = EXCLUDED.response_body,
          expires_at = EXCLUDED.expires_at;
    `;
    await executor.query(query, [
      record.key,
      record.handler,
      record.request_hash,
      record.response_code,
      JSON.stringify(record.response_body),
      record.expires_at.toISOString(),
    ]);
  }

  async deleteExpired(): Promise<number> {
    const query = `DELETE FROM idempotency_keys WHERE expires_at <= NOW();`;
    const res = await this.db.query(query);
    return res.rowCount;
  }
}
