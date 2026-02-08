```js
import { sql } from '@vercel/postgres';
import fs from 'node:fs';
import path from 'node:path';


async function run() {
const files = [
path.join(process.cwd(), 'db', 'migrations', '001_init.sql'),
path.join(process.cwd(), 'db', 'migrations', '002_scans.sql'),
path.join(process.cwd(), 'db', 'migrations', '003_scan_sources.sql'),
path.join(process.cwd(), 'db', 'migrations', '004_scan_results_extended.sql'),
];
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
