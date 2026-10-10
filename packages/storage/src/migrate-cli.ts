import { Pool, migrate } from './index.ts';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL est requis.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(pool);
  console.log('Migrations appliquées.');
} finally {
  await pool.end();
}
