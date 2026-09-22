import { newDb, IMemoryDb, DataType } from 'pg-mem';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabasePool, DbClient, QueryResult } from '../src/db/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class InMemoryDatabasePool implements DatabasePool {
  private memDb: IMemoryDb;
  private pgAdapter: any;

  constructor() {
    this.memDb = newDb();

    // Register gen_random_uuid with impure: true so a fresh UUID is generated on every invocation
    this.memDb.public.registerFunction({
      name: 'gen_random_uuid',
      impure: true,
      implementation: () => crypto.randomUUID(),
    });

    // Register round functions for float and decimal
    this.memDb.public.registerFunction({
      name: 'round',
      args: [DataType.float, DataType.integer],
      returns: DataType.float,
      implementation: (v: number, p: number) => {
        if (v === null || v === undefined) return 0;
        const factor = Math.pow(10, p || 0);
        return Math.round(v * factor) / factor;
      },
    });

    this.memDb.public.registerFunction({
      name: 'round',
      args: [DataType.decimal, DataType.integer],
      returns: DataType.decimal,
      implementation: (v: number, p: number) => {
        if (v === null || v === undefined) return 0;
        const factor = Math.pow(10, p || 0);
        return Math.round(v * factor) / factor;
      },
    });

    // Register date difference or casting if needed
    this.pgAdapter = this.memDb.adapters.createPg();
  }

  async initSchema(): Promise<void> {
    const schemaPath = path.join(__dirname, '../src/db/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute DDL statements
    await this.memDb.public.none(sql);
  }

  async query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const client = new this.pgAdapter.Client();
    await client.connect();
    try {
      const res = await client.query(text, params);
      return {
        rows: res.rows as T[],
        rowCount: res.rowCount ?? 0,
      };
    } finally {
      await client.end();
    }
  }

  async connect(): Promise<DbClient> {
    const client = new this.pgAdapter.Client();
    await client.connect();
    return {
      query: async <T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> => {
        const res = await client.query(text, params);
        return {
          rows: res.rows as T[],
          rowCount: res.rowCount ?? 0,
        };
      },
      release: () => {
        client.end().catch(() => {});
      },
    };
  }

  async transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (e) {}
      throw error;
    } finally {
      if (client.release) client.release();
    }
  }

  async end(): Promise<void> {
    // No-op for in-memory db
  }
}

export async function createTestDatabase(): Promise<DatabasePool> {
  const pool = new InMemoryDatabasePool();
  await pool.initSchema();
  return pool;
}
