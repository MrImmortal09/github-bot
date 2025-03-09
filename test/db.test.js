import { describe, test } from "node:test";
import assert from "assert";
import initDB from "../src/db/index.js";

describe("Database", () => {
  test("should create necessary tables", async () => {
    const db = await initDB();
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(t => t.name);
    assert.ok(tableNames.includes("assignments"), "Missing 'assignments' table");
    assert.ok(tableNames.includes("user_queues"), "Missing 'user_queues' table");
    assert.ok(tableNames.includes("blocked_users"), "Missing 'blocked_users' table");
  });
});
