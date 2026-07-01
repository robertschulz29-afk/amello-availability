// Temporary script to export reference data from the live database
// Run: node scripts/export-seed-data.mjs
import pg from 'pg';
import fs from 'node:fs';

const { Pool } = pg;

// Load DATABASE_URL from .env.local
const envRaw = fs.readFileSync('.env.local', 'utf8');
const envMatch = envRaw.match(/DATABASE_URL=(.+)/);
if (!envMatch) { console.error('DATABASE_URL not found'); process.exit(1); }
const DATABASE_URL = envMatch[1].trim();

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

function escapeStr(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function escapeVal(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') return escapeStr(JSON.stringify(val));
  return escapeStr(String(val));
}

async function exportTable(tableName, columns) {
  const res = await pool.query(`SELECT ${columns.join(', ')} FROM ${tableName} ORDER BY id`);
  if (res.rows.length === 0) return `-- (no rows in ${tableName})`;

  const lines = res.rows.map(row => {
    const vals = columns.map(c => {
      const v = row[c];
      if (v instanceof Date) return escapeStr(v.toISOString());
      return escapeVal(v);
    });
    return `  (${vals.join(', ')})`;
  });

  return `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES\n${lines.join(',\n')}\nON CONFLICT DO NOTHING;`;
}

async function main() {
  try {
    // Export global_types
    // Check actual columns
    const colsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'global_types'
      ORDER BY ordinal_position
    `);
    const gtCols = colsRes.rows.map(r => r.column_name);
    console.log('global_types columns:', gtCols);
    const gtExport = await exportTable('global_types', gtCols);

    // Export global_type_collector
    const gcColsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'global_type_collector'
      ORDER BY ordinal_position
    `);
    const gcCols = gcColsRes.rows.map(r => r.column_name);
    console.log('global_type_collector columns:', gcCols);
    const gcExport = await exportTable('global_type_collector', gcCols);

    // Export room_mappings
    const rmColsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'room_mappings'
      ORDER BY ordinal_position
    `);
    const rmCols = rmColsRes.rows.map(r => r.column_name);
    console.log('room_mappings columns:', rmCols);
    const rmExport = await exportTable('room_mappings', rmCols);

    // Export hotels
    const hColsRes = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'hotels'
      ORDER BY ordinal_position
    `);
    const hCols = hColsRes.rows.map(r => r.column_name);
    console.log('hotels columns:', hCols);
    const hExport = await exportTable('hotels', hCols);

    const output = [
      '-- global_types data',
      gtExport,
      '',
      '-- global_type_collector data',
      gcExport,
      '',
      '-- room_mappings data',
      rmExport,
      '',
      '-- hotels data',
      hExport,
    ].join('\n');

    fs.writeFileSync('scripts/exported-seed-data.sql', output);
    console.log('Written to scripts/exported-seed-data.sql');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
