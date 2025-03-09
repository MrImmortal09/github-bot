import { issueClosed, issueCommentCreated, issueOpened } from "./func/issues.js";
import { pullRequestClosed } from "./func/pullRequest.js";

export default function init(app) {
  app.on("pull_request.closed", pullRequestClosed);
  // When an issue is opened, comment on it.
  app.on("issues.opened", issueOpened);

  // When an issue is closed (e.g. manually), remove assignment and reprocess the queue.
  app.on("issues.closed", issueClosed);

  // Listen for issue comment commands.
  app.on('issue_comment.created', issueCommentCreated);
}
