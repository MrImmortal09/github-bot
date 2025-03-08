import registerPRHandler from "../src/pullRequestHandler.js";
import { assignmentManager } from "../src/assignmentManager.js";
import initDB from "../src/db.js";
import { describe, beforeEach, test } from "node:test";
import assert from "node:assert";

describe("Pull Request Handler (pullRequestHandler.js)", () => {
  let app;
  let context;
  const repo = { owner: { login: "owner" }, name: "repo", full_name: "owner/repo" };
  const pr = { merged: true, body: "This PR closes #1", user: { login: "testuser" } };

  beforeEach(async () => {
    // Clear the database.
    const db = await initDB();
    await db.exec("DELETE FROM assignments; DELETE FROM user_queues; DELETE FROM blocked_users;");
    // Insert an assignment for issue #1.
    const deadline = Date.now() + 10000;
    await assignmentManager.addAssignment(repo, { number: 1 }, "testuser", deadline);

    // Create a fake octokit instance with minimal methods.
    const fakeOctokit = {
      issues: {
        removeAssignees: async () => ({}),
        createComment: async () => ({}),
        get: async () => ({ data: { state: "open", assignees: [] } })
      }
    };

    context = {
      payload: {
        pull_request: pr,
        repository: repo
      },
      octokit: fakeOctokit
    };

    // Create a fake app that immediately triggers the handler.
    app = {
      on: (event, handler) => {
        if (event === "pull_request.closed") {
          handler(context);
        }
      },
      log: { error: () => {}, info: () => {} }
    };

    registerPRHandler(app);
  });

  test("should remove assignment on merged PR and process queue", async () => {
    // Allow async actions to complete.
    await new Promise(resolve => setTimeout(resolve, 50));
    const assignment = await assignmentManager.getAssignment(repo, { number: 1 });
    assert.strictEqual(assignment, undefined, "Assignment was not removed after PR merge");
  });
});
