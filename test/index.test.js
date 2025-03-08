import nock from "nock";
import myProbotApp from "../index.js";
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

// Read the fixture payload for issues.opened.
const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/issues.opened.json"), "utf-8")
);

// Expected comment body as defined in your index.js handler.
const issueCreatedBody = { body: "Thanks for opening this issue!" };

describe("My Probot App (index)", () => {
  let probot;

  beforeEach(() => {
    // Disable real HTTP requests.
    nock.disableNetConnect();

    probot = new Probot({
      appId: 123,
      privateKey,
      // Disable retries and throttling to simplify tests.
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });

    // Load your app.
    probot.load(myProbotApp);
  });

  test("creates a comment when an issue is opened", async () => {
    const mock = nock("https://api.github.com")
      // Simulate token request for the installation.
      .post("/app/installations/2/access_tokens")
      .reply(200, {
        token: "test",
        permissions: { issues: "write" },
      })
      // Simulate posting a comment to the issue.
      .post("/repos/hiimbex/testing-things/issues/1/comments", (body) => {
        assert.deepStrictEqual(body, issueCreatedBody);
        return true;
      })
      .reply(200);

    // Simulate receiving the issues.opened webhook event.
    await probot.receive({ name: "issues", payload });

    // Verify that all expected HTTP calls were made.
    assert.deepStrictEqual(mock.pendingMocks(), []);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });
});

// For more information about testing with Jest see:
// https://facebook.github.io/jest/

// For more information about testing with Nock see:
// https://github.com/nock/nock
