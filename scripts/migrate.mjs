import { sql } from '@vercel/postgres';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  const initFile = path.join(process.cwd(), 'db', 'init.sql');
  const ddl = fs.readFileSync(initFile, 'utf8');
  await sql`${sql.raw(ddl)}`;
  console.log('Applied db/init.sql — schema initialized');
}

run().catch((e) => { console.error(e); process.exit(1); });
