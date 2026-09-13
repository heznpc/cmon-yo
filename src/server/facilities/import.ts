import type pg from 'pg';
import { normalizeSnapshot, source, SourceError } from './source';

export async function importParks(pool: pg.Pool, input: unknown, dryRun: boolean) {
  const startedAt = new Date().toISOString();
  const records =
    typeof input === 'object' && input !== null && 'records' in input ? input.records : null;
  const report = {
    status: 'failed',
    dryRun,
    received: Array.isArray(records) ? records.length : 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    failedRows: [] as number[],
  };
  try {
    const places = normalizeSnapshot(input);
    report.received = places.length;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(15012890)');
      for (const place of places) {
        const key = place.id.slice(5);
        const existing = await client.query<{ same: boolean }>(
          'SELECT document = $3::jsonb AS same FROM places WHERE source = $1 AND source_key = $2',
          [source, key, JSON.stringify(place)],
        );
        if (!existing.rowCount) report.inserted++;
        else if (existing.rows[0].same) report.unchanged++;
        else report.updated++;
        if (!dryRun && !existing.rows[0]?.same)
          await client.query(
            `INSERT INTO places(source, source_key, document) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (source, source_key) DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
            [source, key, JSON.stringify(place)],
          );
      }
      report.status = 'succeeded';
      await client.query('INSERT INTO facility_import_runs(started_at, report) VALUES ($1, $2)', [
        startedAt,
        report,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    report.status = 'failed';
    report.inserted = report.updated = report.unchanged = 0;
    if (error instanceof SourceError) report.failedRows = error.rows;
    // No raw rows, connection string, credential, provider URL or exception text in logs.
    await pool.query('INSERT INTO facility_import_runs(started_at, report) VALUES ($1, $2)', [
      startedAt,
      report,
    ]);
  }
  return report;
}
