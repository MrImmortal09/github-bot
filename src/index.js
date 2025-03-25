import { issueClosed, issueCommentCreated, issueOpened } from "./func/issues.js";
import { pullRequestClosed, pullRequestCommentCreated } from "./func/pullRequest.js";

export default function init(app) {

  // When a pull request is closed, remove assignment and reprocess the queue.
  app.on("pull_request.closed", pullRequestClosed);

  // When an issue is opened, comment on it.
  app.on("issues.opened", issueOpened);

  // When an issue is closed (e.g. manually), remove assignment and reprocess the queue.
  app.on("issues.closed", issueClosed);

  // Listen for issue comment commands.
  app.on("issue_comment.created", issueCommentCreated);

}