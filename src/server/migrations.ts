import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './transaction';

const files = [
  { name: '001_places.sql', repeatable: true },
  { name: '002_meetups.sql', repeatable: true },
  { name: '003_community.sql', repeatable: true },
  { name: '004_attendance.sql', repeatable: true },
  { name: '005_place_favorites.sql', repeatable: true },
  { name: '006_activity_quests.sql', repeatable: false },
];

export async function migrateDatabase(pool: pg.Pool, through = files.length) {
  if (!Number.isInteger(through) || through < 1 || through > files.length)
    throw new Error('Unknown database migration boundary.');
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(15012890)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const { name, repeatable } of files.slice(0, through)) {
      const sql = await readFile('db/' + name, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = (
        await client.query<{ checksum: string }>(
          'SELECT checksum FROM schema_migrations WHERE name=$1',
          [name],
        )
      ).rows[0];
      if (old && old.checksum !== checksum) throw new Error('Applied migration changed: ' + name);
      // Legacy entry points reapply their idempotent baselines, including when a
      // test has recreated those tables. New migrations require a fresh schema.
      if (old && !repeatable) continue;
      await client.query(sql);
      if (!old)
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
          name,
          checksum,
        ]);
    }
  });
}

export async function migrateWalking(pool: pg.Pool) {
  await migrateDatabase(pool, 6);
}
