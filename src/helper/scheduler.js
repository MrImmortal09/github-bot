import { assignmentManager } from './assignmentManager.js';

export async function processExpiredAssignments(context) {
  const now = Date.now();
  const assignments = await assignmentManager.getAllAssignments();
  for (const assignment of assignments) {
    if (assignment.deadline < now) {
      try {
        const repoParts = assignment.repo.split('/');
        const repo = {
          full_name: assignment.repo,
          name: repoParts[1],
          owner: { login: repoParts[0] }
        };
        const issue = { number: assignment.issue_number };
        await context.octokit.issues.removeAssignees({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          assignees: [assignment.assignee]
        });
        const body = `Assignment for @${assignment.assignee} has expired and been removed. You are blocked from new assignments for 5 hours.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
        // Updated call: pass repo and issue for per-issue block.
        await assignmentManager.blockUser(repo, issue, assignment.assignee, 5);
        await assignmentManager.removeAssignment(repo, issue);
      } catch (error) {
        console.log(error);
      }
    }
  }
}

export async function processQueuedAssignments(context) {
  const queuedUsers = await assignmentManager.getAllQueuedUsers();
  for (const user of queuedUsers) {
    try {
      // Updated call: pass context.octokit instead of context.
      await assignmentManager.processQueueForUser(user, context.octokit);
    } catch (error) {
      console.log(error)
    }
  }
}

export default function start(app) {
  // Scheduler runs every minute.
  return async (context) => { 
    setInterval( async () => {
      await processExpiredAssignments(context);
      await processQueuedAssignments(context);
    }, 60 * 1000 );
  }
}
