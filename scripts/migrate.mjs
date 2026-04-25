import { sql } from '@vercel/postgres';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  const files = [
    '021_scan_hotels_snapshot.sql',
  ].map(f => path.join(process.cwd(), 'db', 'migrations', f));

  for (const file of files) {
    const ddl = fs.readFileSync(file, 'utf8');
    if (ddl.trim()) {
      await sql`${sql.raw(ddl)}`;
      console.log('Applied', path.basename(file));
    }
  }
  console.log('All migrations applied');
}

run().catch((e) => { console.error(e); process.exit(1); });
