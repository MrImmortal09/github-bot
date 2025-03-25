import { assignmentManager } from "../helper/assignmentManager.js";

export const pullRequestClosed = async (context) => {
  const pr = context.payload.pull_request;
  // Only proceed if the PR was merged.
  if (!pr.merged) return;

  const repo = context.payload.repository;
  const sender = pr.user.login;
  const closeRegex = /closes\s+#(\d+)/gi;
  let match;
  while ((match = closeRegex.exec(pr.body)) !== null) {
    const issueNumber = parseInt(match[1], 10);
    try {
      await context.octokit.issues.removeAssignees({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issueNumber,
        assignees: [sender]
      });
      // Check if an assignment exists before removal.
      const assignment = await assignmentManager.getAssignment(repo, { number: issueNumber });
      if (assignment) {
        await assignmentManager.removeAssignment(repo, { number: issueNumber });
        // If the user was blocked for this issue, clear the block.
        if (await assignmentManager.isUserBlocked(repo, { number: issueNumber }, sender)) {
          await assignmentManager.clearBlock(repo, { number: issueNumber }, sender);
        }
        const body = `Assignment for @${sender} on issue #${issueNumber} has been completed with the PR merge.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issueNumber,
          body
        });
        // Process the user's queue.
        await assignmentManager.processQueueForUser(sender, context.octokit);
      }
    } catch (error) {
      context.log.error(`Error handling PR merge for issue #${issueNumber}:`, error);
    }
  }
};
