import pg from 'pg';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  release?: () => void;
}

export interface DatabasePool {
  query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<DbClient>;
  end(): Promise<void>;
  transaction<T>(callback: (client: DbClient) => Promise<T>): Promise<T>;
}

class PostgresDatabasePool implements DatabasePool {
  private pool: pg.Pool;

  constructor(connectionString?: string) {
    const connStr = connectionString || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/agresearch_db';
    this.pool = new pg.Pool({
      connectionString: connStr,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async query<T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const res = await this.pool.query(text, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? 0,
    };
  }

  async connect(): Promise<DbClient> {
    const client = await this.pool.connect();
    return {
      query: async <T = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> => {
        const res = await client.query(text, params);
        return {
          rows: res.rows as T[],
          rowCount: res.rowCount ?? 0,
        };
      },
      release: () => client.release(),
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
      } catch (rollbackError) {
        // preserve original error
      }
      throw error;
    } finally {
      if (client.release) client.release();
    }
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

let defaultPool: DatabasePool | null = null;

export function getDatabasePool(connectionString?: string): DatabasePool {
  if (!defaultPool) {
    defaultPool = new PostgresDatabasePool(connectionString);
  }
  return defaultPool;
}

export function setDatabasePool(pool: DatabasePool): void {
  defaultPool = pool;
}
