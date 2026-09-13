import { getMigrations } from 'better-auth/db/migration';
import { createPool } from '../src/server/db';
import { createAuth, socialProviders } from '../src/server/auth/service';
import { authMailer } from '../src/server/auth/mail';

if (process.argv[2] !== 'migrate') throw new Error('Usage: npm run with-env -- auth -- migrate');
if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET)
  throw new Error('DATABASE_URL and AUTH_SECRET are required.');
const pool = createPool(process.env.DATABASE_URL);
try {
  const auth = createAuth({
    pool,
    origin: process.env.AUTH_ORIGIN ?? 'http://127.0.0.1:3000',
    secret: process.env.AUTH_SECRET,
    sendMail: authMailer(process.env),
    providers: socialProviders(process.env),
  });
  const plan = await getMigrations(auth.options);
  if (plan.schemaProblems.length || plan.unsafeChanges.length)
    throw new Error('Authentication schema requires a reviewed migration.');
  await plan.runMigrations();
  console.log('Authentication schema migration applied.');
} finally {
  await pool.end();
}
