import initDB from "../src/db.js";
import { describe, test } from "node:test";
import assert from "node:assert";

describe("Database (db.js)", () => {
  test("should create necessary tables", async () => {
    const db = await initDB();
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(t => t.name);
    assert.ok(tableNames.includes("assignments"), "Missing 'assignments' table");
    assert.ok(tableNames.includes("user_queues"), "Missing 'user_queues' table");
    assert.ok(tableNames.includes("blocked_users"), "Missing 'blocked_users' table");
  });
});
