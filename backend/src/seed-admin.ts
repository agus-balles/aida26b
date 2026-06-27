import { Pool } from 'pg';
import dotenv from 'dotenv';
import { hashPassword, isStrongPassword } from './auth';

dotenv.config();

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const email = process.env.ADMIN_EMAIL?.trim() || null;

  if (!username || !isStrongPassword(password)) {
    throw new Error('ADMIN_USERNAME and a strong ADMIN_PASSWORD are required');
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const { passwordHash, passwordSalt } = await hashPassword(password);
  await pool.query(
    `INSERT INTO auth.users (username, email, password_hash, password_salt, role, is_active, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', true, false)
     ON CONFLICT (username) DO UPDATE
       SET email = EXCLUDED.email,
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt,
           role = 'admin',
           is_active = true,
           must_change_password = false,
           updated_at = now()`,
    [username, email, passwordHash, passwordSalt],
  );

  await pool.end();
  console.log(`Admin user ready: ${username}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
