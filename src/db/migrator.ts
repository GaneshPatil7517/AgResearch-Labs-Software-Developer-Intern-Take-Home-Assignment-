import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabasePool, DatabasePool } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(dbPool?: DatabasePool): Promise<void> {
  const db = dbPool || getDatabasePool();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running database migrations...');
  await db.query(sql);
  console.log('✅ Migrations completed successfully.');
}

// Run directly if called as a script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
