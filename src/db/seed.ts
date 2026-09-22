import { getDatabasePool, DatabasePool } from './connection.js';
import { runMigrations } from './migrator.js';

export async function seedDatabase(dbPool?: DatabasePool): Promise<void> {
  const db = dbPool || getDatabasePool();
  await runMigrations(db);

  console.log('Seeding initial data...');

  // 1. Seed Trays across multiple zones
  const traysData = [
    { code: 'T-A-001', zone: 'Zone-A', capacity_units: 120 },
    { code: 'T-A-002', zone: 'Zone-A', capacity_units: 120 },
    { code: 'T-A-003', zone: 'Zone-A', capacity_units: 100 },
    { code: 'T-B-001', zone: 'Zone-B', capacity_units: 150 },
    { code: 'T-B-002', zone: 'Zone-B', capacity_units: 150 },
    { code: 'T-C-001', zone: 'Zone-C', capacity_units: 80 },
  ];

  const createdTrays: Record<string, string> = {};
  for (const t of traysData) {
    const res = await db.query(
      `INSERT INTO trays (code, zone, capacity_units)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET zone = EXCLUDED.zone
       RETURNING id, code;`,
      [t.code, t.zone, t.capacity_units]
    );
    createdTrays[t.code] = res.rows[0].id;
  }

  // 2. Seed Batches in various stages
  // T-A-001: Active SEEDED batch
  await db.query(
    `INSERT INTO batches (tray_id, crop, seeded_on, stage, expected_harvest_on)
     VALUES ($1, 'Butterhead Lettuce', '2026-09-18', 'SEEDED', '2026-10-15')
     ON CONFLICT DO NOTHING;`,
    [createdTrays['T-A-001']]
  );

  // T-A-002: Active GROWING batch
  await db.query(
    `INSERT INTO batches (tray_id, crop, seeded_on, stage, expected_harvest_on)
     VALUES ($1, 'Arugula', '2026-09-10', 'GROWING', '2026-10-05')
     ON CONFLICT DO NOTHING;`,
    [createdTrays['T-A-002']]
  );

  // T-B-001: Active HARVEST_READY batch
  await db.query(
    `INSERT INTO batches (tray_id, crop, seeded_on, stage, expected_harvest_on)
     VALUES ($1, 'Tuscan Kale', '2026-08-25', 'HARVEST_READY', '2026-09-20')
     ON CONFLICT DO NOTHING;`,
    [createdTrays['T-B-001']]
  );

  // T-B-002: Previously HARVESTED batch (tray is now free)
  const harvestedBatchRes = await db.query(
    `INSERT INTO batches (tray_id, crop, seeded_on, stage, expected_harvest_on)
     VALUES ($1, 'Romaine Lettuce', '2026-08-01', 'HARVESTED', '2026-08-28')
     RETURNING id;`,
    [createdTrays['T-B-002']]
  );

  if (harvestedBatchRes.rows[0]) {
    await db.query(
      `INSERT INTO harvests (batch_id, harvested_on, weight_grams, grade)
       VALUES ($1, '2026-08-29', 2450.0, 'A')
       ON CONFLICT (batch_id) DO NOTHING;`,
      [harvestedBatchRes.rows[0].id]
    );
  }

  // T-C-001: Another previously HARVESTED batch for yield report data
  const harvestedBatchRes2 = await db.query(
    `INSERT INTO batches (tray_id, crop, seeded_on, stage, expected_harvest_on)
     VALUES ($1, 'Genovese Basil', '2026-08-05', 'HARVESTED', '2026-09-02')
     RETURNING id;`,
    [createdTrays['T-C-001']]
  );

  if (harvestedBatchRes2.rows[0]) {
    await db.query(
      `INSERT INTO harvests (batch_id, harvested_on, weight_grams, grade)
       VALUES ($1, '2026-09-03', 1120.5, 'B')
       ON CONFLICT (batch_id) DO NOTHING;`,
      [harvestedBatchRes2.rows[0].id]
    );
  }

  console.log('✅ Seeding completed successfully.');
}

// Run directly if called as a script
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}
