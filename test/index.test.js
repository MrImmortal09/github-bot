import nock from "nock";
import init from "../src/index.js";
import { issueClosed, issueCommentCreated, issueOpened } from "../src/func/issues.js";
import { pullRequestClosed } from "../src/func/pullRequest.js";
import { Probot, ProbotOctokit } from "probot";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read a mock certificate for authentication.
const privateKey = fs.readFileSync(
  path.join(__dirname, "fixtures/mock-cert.pem"),
  "utf-8"
);

describe("My Probot App (index)", () => {
  let probot;

  beforeEach(() => {
    nock.disableNetConnect();

    probot = new Probot({
      appId: 123,
      privateKey,
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });

    probot.load(init);
  });

  test("should register the correct event handlers", () => {
    const fakeApp = {
      handlers: {},
      on(event, handler) {
        this.handlers[event] = handler;
      },
    };

    init(fakeApp);

    assert.strictEqual(
      fakeApp.handlers["pull_request.closed"],
      pullRequestClosed,
      'Expected "pull_request.closed" handler to be pullRequestClosed'
    );
    assert.strictEqual(
      fakeApp.handlers["issues.opened"],
      issueOpened,
      'Expected "issues.opened" handler to be issueOpened'
    );
    assert.strictEqual(
      fakeApp.handlers["issues.closed"],
      issueClosed,
      'Expected "issues.closed" handler to be issueClosed'
    );
    assert.strictEqual(
      fakeApp.handlers["issue_comment.created"],
      issueCommentCreated,
      'Expected "issue_comment.created" handler to be issueCommentCreated'
    );
  });

  const payload = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/issues.opened.json"), "utf-8")
  );
  const issueCreatedBody = { body: "Thanks for opening this issue!" };

  test("creates a comment when an issue is opened", async () => {
    const mock = nock("https://api.github.com")
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: { issues: "write" },
      })
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body) => {
        assert.deepStrictEqual(body, issueCreatedBody);
        return true;
      })
      .reply(200);

    await probot.receive({ name: "issues", payload });

    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});
