import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbPromise;

export default async function initDB() {
  if (!dbPromise) {
    dbPromise = open({
      filename: path.join(__dirname, 'cache/assignments.db'),
      driver: sqlite3.Database
    });

    const db = await dbPromise;
    // Create tables if they don't exist.
    await db.exec(`
      CREATE TABLE IF NOT EXISTS assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT,
        issue_number INTEGER,
        assignee TEXT,
        deadline INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      
      CREATE TABLE IF NOT EXISTS user_queues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        repo TEXT,
        issue_number INTEGER,
        duration INTEGER,
        retry_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      
      CREATE TABLE IF NOT EXISTS blocked_users (
        username TEXT PRIMARY KEY,
        blocked_until INTEGER
      );
    `);
  }
  return dbPromise;
}
