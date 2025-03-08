import { assignmentManager } from "../src/assignmentManager.js";
import initDB from "../src/db.js";
import { describe, beforeEach, test } from "node:test";
import assert from "node:assert";

describe("Assignment Manager (assignmentManager.js)", () => {
  let db;
  const repo = { full_name: "owner/repo", name: "repo", owner: { login: "owner" } };
  const issue = { number: 1 };
  const user = "testuser";

  beforeEach(async () => {
    db = await initDB();
    // Clear the tables before each test.
    await db.exec("DELETE FROM assignments; DELETE FROM user_queues; DELETE FROM blocked_users;");
  });

  test("should add and get an assignment", async () => {
    const deadline = Date.now() + 10000;
    await assignmentManager.addAssignment(repo, issue, user, deadline);
    const assignment = await assignmentManager.getAssignment(repo, issue);
    assert.ok(assignment, "Assignment was not added");
    assert.strictEqual(assignment.assignee, user);
  });

  test("should remove an assignment", async () => {
    const deadline = Date.now() + 10000;
    await assignmentManager.addAssignment(repo, issue, user, deadline);
    await assignmentManager.removeAssignment(repo, issue);
    const assignment = await assignmentManager.getAssignment(repo, issue);
    assert.strictEqual(assignment, undefined, "Assignment was not removed");
  });

  test("should extend assignment deadline", async () => {
    const deadline = Date.now() + 10000;
    await assignmentManager.addAssignment(repo, issue, user, deadline);
    const extension = 5000;
    const success = await assignmentManager.extendAssignment(repo, issue, extension);
    assert.ok(success, "Extension failed");
    const updated = await assignmentManager.getAssignment(repo, issue);
    assert.ok(updated.deadline > deadline, "Deadline was not extended");
  });

  test("should process queue and assign issue when open", async () => {
    // Create a fake octokit instance with mocked methods.
    const fakeOctokit = {
      issues: {
        get: async ({ owner, repo, issue_number }) => {
          return { data: { state: "open", assignees: [] } };
        },
        addAssignees: async ({ owner, repo, issue_number, assignees }) => ({}),
        createComment: async ({ owner, repo, issue_number, body }) => ({}),
      }
    };

    const duration = 3600000; // 1 hour
    await assignmentManager.addToQueue(user, { repo, issue, duration });
    // With fewer than 4 active assignments, processing the queue should assign the issue.
    await assignmentManager.processQueueForUser(user, fakeOctokit);
    const assignment = await assignmentManager.getAssignment(repo, issue);
    assert.ok(assignment, "Queued assignment was not processed");
    // Also, verify that the queue entry was removed.
    const queuedEntry = await db.get("SELECT * FROM user_queues WHERE username = ?", [user]);
    assert.strictEqual(queuedEntry, undefined, "Queue entry was not removed");
  });
});
