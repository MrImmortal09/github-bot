import { issueOpened, issueClosed, issueCommentCreated } from "../src/func/issues.js";
import { assignmentManager } from "../src/helper/assignmentManager.js";
import { describe, it, beforeEach } from "node:test";
import assert from "assert";

// Provide a dummy global app for error logging inside catch blocks.
global.app = {
  log: { error: () => {} }
};

describe("issueOpened", () => {
  it("should create a comment when an issue is opened", async () => {
    let createCommentCalled = false;
    let createCommentPayload = null;

    const fakeContext = {
      issue: (obj) => obj,
      octokit: {
        issues: {
          createComment: async (payload) => {
            createCommentCalled = true;
            createCommentPayload = payload;
            return payload;
          }
        }
      }
    };

    await issueOpened(fakeContext);
    assert.strictEqual(createCommentCalled, true, "createComment was not called");
    assert.deepStrictEqual(createCommentPayload, { body: "Thanks for opening this issue!" });
  });
});

describe("issueClosed", () => {
  let removeAssignmentCalled = false;
  let processQueueCalled = false;

  beforeEach(() => {
    assignmentManager.getAssignment = async (repository, issue) => {
      return { assignee: "testuser" };
    };
    assignmentManager.removeAssignment = async (repository, issue) => {
      removeAssignmentCalled = true;
    };
    assignmentManager.processQueueForUser = async (assignee, octokit) => {
      processQueueCalled = true;
    };
  });

  it("should remove assignment and process queue when an assignment exists", async () => {
    removeAssignmentCalled = false;
    processQueueCalled = false;

    const fakeContext = {
      payload: {
        repository: { owner: { login: "owner" }, name: "repo" },
        issue: { number: 101 }
      },
      octokit: {}
    };

    await issueClosed(fakeContext);
    assert.strictEqual(removeAssignmentCalled, true, "removeAssignment was not called");
    assert.strictEqual(processQueueCalled, true, "processQueueForUser was not called");
  });

  it("should do nothing if no assignment exists", async () => {
    assignmentManager.getAssignment = async (repository, issue) => undefined;
    removeAssignmentCalled = false;
    processQueueCalled = false;

    const fakeContext = {
      payload: {
        repository: { owner: { login: "owner" }, name: "repo" },
        issue: { number: 101 }
      },
      octokit: {}
    };

    await issueClosed(fakeContext);
    assert.strictEqual(removeAssignmentCalled, false, "removeAssignment should not be called");
    assert.strictEqual(processQueueCalled, false, "processQueueForUser should not be called");
  });
});

describe("issueCommentCreated", () => {
  let addAssignmentCalled = false;
  let addToQueueCalled = false;
  let removeAssignmentCalled = false;
  let processQueueCalled = false;
  let extendAssignmentCalled = false;
  let getAssignmentDeadlineCalled = false;
  let isUserBlockedValue = false;
  let activeCountValue = 0;
  let blockTime = Date.now() + 10000;

  beforeEach(() => {
    addAssignmentCalled = false;
    addToQueueCalled = false;
    removeAssignmentCalled = false;
    processQueueCalled = false;
    extendAssignmentCalled = false;
    getAssignmentDeadlineCalled = false;
    isUserBlockedValue = false;
    activeCountValue = 0;

    // Updated stubs: now pass repo and issue.
    assignmentManager.isUserBlocked = async (repo, issue, user) => isUserBlockedValue;
    assignmentManager.getUserBlockTime = async (repo, issue, user) => blockTime;
    assignmentManager.getUserActiveAssignmentCount = async (user) => activeCountValue;
    assignmentManager.addToQueue = async (user, assignment) => {
      addToQueueCalled = true;
    };
    assignmentManager.addAssignment = async (repo, issue, user, deadline) => {
      addAssignmentCalled = true;
    };
    assignmentManager.removeAssignment = async (repo, issue) => {
      removeAssignmentCalled = true;
    };
    assignmentManager.processQueueForUser = async (user, octokit) => {
      processQueueCalled = true;
    };
    assignmentManager.extendAssignment = async (repo, issue, extension) => {
      extendAssignmentCalled = true;
      return true;
    };
    assignmentManager.getAssignmentDeadline = async (repo, issue) => {
      getAssignmentDeadlineCalled = true;
      return Date.now() + 10000;
    };
  });

  it("should handle /assign command when user is not blocked and under limit", async () => {
    const fakeContext = {
      payload: {
        comment: { user: { login: "testuser" }, body: "/assign" },
        issue: { number: 202, labels: [{ name: "easy" }] },
        repository: { owner: { login: "owner" }, name: "repo" }
      },
      octokit: {
        issues: {
          addAssignees: async ({ owner, repo, issue_number, assignees }) => {},
          createComment: async ({ owner, repo, issue_number, body }) => {}
        }
      }
    };
    activeCountValue = 0;
    await issueCommentCreated(fakeContext);
    assert.strictEqual(addAssignmentCalled, true, "addAssignment should be called for /assign");
  });

  it("should add assignment to queue when user already has 4 active assignments", async () => {
    const fakeContext = {
      payload: {
        comment: { user: { login: "testuser" }, body: "/assign" },
        issue: { number: 303, labels: [{ name: "easy" }] },
        repository: { owner: { login: "owner" }, name: "repo" }
      },
      octokit: {
        issues: {
          addAssignees: async ({ owner, repo, issue_number, assignees }) => {},
          createComment: async ({ owner, repo, issue_number, body }) => {}
        }
      }
    };
    activeCountValue = 4;
    await issueCommentCreated(fakeContext);
    assert.strictEqual(addToQueueCalled, true, "addToQueue should be called when active count is 4 or more");
  });

  it("should handle /unassign command", async () => {
    const fakeContext = {
      payload: {
        comment: { user: { login: "testuser" }, body: "/unassign" },
        issue: { number: 404, labels: [] },
        repository: { owner: { login: "owner" }, name: "repo" }
      },
      octokit: {
        issues: {
          removeAssignees: async ({ owner, repo, issue_number, assignees }) => {},
          createComment: async ({ owner, repo, issue_number, body }) => {}
        }
      }
    };
    await issueCommentCreated(fakeContext);
    assert.strictEqual(removeAssignmentCalled, true, "removeAssignment should be called for /unassign");
    assert.strictEqual(processQueueCalled, true, "processQueueForUser should be called for /unassign");
  });

  it("should handle /extend command for an authorized maintainer", async () => {
    const fakeContext = {
      payload: {
        comment: { user: { login: "maintainer1" }, body: "/extend-2h" },
        issue: { number: 505, labels: [] },
        repository: { owner: { login: "owner" }, name: "repo" }
      },
      octokit: {
        issues: {
          createComment: async ({ owner, repo, issue_number, body }) => {}
        }
      }
    };
    await issueCommentCreated(fakeContext);
    assert.strictEqual(extendAssignmentCalled, true, "extendAssignment should be called for /extend command");
    assert.strictEqual(getAssignmentDeadlineCalled, true, "getAssignmentDeadline should be called for /extend command");
  });

  it("should handle /extend command for an unauthorized user", async () => {
    const fakeContext = {
      payload: {
        comment: { user: { login: "notMaintainer" }, body: "/extend-1h" },
        issue: { number: 606, labels: [] },
        repository: { owner: { login: "owner" }, name: "repo" }
      },
      octokit: {
        issues: {
          createComment: async ({ owner, repo, issue_number, body }) => {
            fakeContext.responseBody = body;
          }
        }
      }
    };
    await issueCommentCreated(fakeContext);
    assert.ok(
      fakeContext.responseBody && fakeContext.responseBody.includes("not authorized"),
      "An unauthorized extension should return a not authorized message"
    );
  });
});
