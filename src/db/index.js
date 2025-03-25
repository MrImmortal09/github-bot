import pkg from 'pg';
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/postgres';
const pool = new Pool({ connectionString });

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id SERIAL PRIMARY KEY,
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        assignee TEXT NOT NULL,
        deadline BIGINT NOT NULL,
        created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_queues (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        duration INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0,
        created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        username TEXT NOT NULL,
        repo TEXT NOT NULL,
        issue_number INTEGER NOT NULL,
        blocked_until BIGINT NOT NULL,
        PRIMARY KEY (username, repo, issue_number)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_points (
        username TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0
      )
    `);
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
})();

export default pool;
