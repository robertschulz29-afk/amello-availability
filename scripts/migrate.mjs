import { sql } from '@vercel/postgres';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  const files = [
    '001_init.sql',
    '002_scans.sql',
    '003_scan_sources.sql',
    '004_scan_results_extended.sql',
    '005_add_hotel_urls.sql',
    '006_add_booking_com_data.sql',
    '007_add_source_to_scan_results.sql',
    '008_add_cancelled_status.sql',
    '009_hotel_room_names.sql',
    '010_global_types_category.sql',
    '011_rename_global_types_snake_case.sql',
    '012_users.sql',
    '013_seed_scan_sources.sql',
    '014_scan_sources_on_scan.sql',
    '015_scan_source_jobs.sql',
    '016_booking_member_source.sql',
    '017_app_settings.sql',
    '018_global_types_filter_group.sql',
    '019_rename_global_type_columns.sql',
    '020_global_type_collector.sql',
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
