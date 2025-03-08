import { assignmentManager } from './src/assignmentManager.js';
import startScheduler from './src/scheduler.js';
import registerPRHandler from './src/pullRequestHandler.js';

export default async (app) => {
  app.log.info("Yay, the app was loaded!");

  // When an issue is opened, comment on it.
  app.on("issues.opened", async (context) => {
    const issueComment = context.issue({
      body: "Thanks for opening this issue!"
    });
    return context.octokit.issues.createComment(issueComment);
  });

  // When an issue is closed (e.g. manually), remove assignment and reprocess the queue.
  app.on("issues.closed", async (context) => {
    const { issue, repository } = context.payload;
    // Instead of relying on issue.assignee (which might be null),
    // try to fetch the assignment record.
    const assignment = await assignmentManager.getAssignment(repository, issue);
    if (assignment) {
      await assignmentManager.removeAssignment(repository, issue);
      // Re-check the queue for the user who had the assignment.
      await assignmentManager.processQueueForUser(assignment.assignee, context.octokit);
    }
  });

  // Listen for issue comment commands.
  app.on('issue_comment.created', async (context) => {
    const { comment, issue } = context.payload;
    const repo = context.payload.repository;
    const sender = comment.user.login;
    const command = comment.body.trim();

    // === /assign Command ===
    if (command.startsWith('/assign')) {
      let duration;
      if (issue.labels.find(label => label.name.toLowerCase() === 'easy')) {
        duration = 1.5 * 60 * 60 * 1000;
      } else if (issue.labels.find(label => label.name.toLowerCase() === 'medium')) {
        duration = 3 * 60 * 60 * 1000;
      } else if (issue.labels.find(label => label.name.toLowerCase() === 'hard')) {
        duration = 5 * 60 * 60 * 1000;
      } else {
        duration = 3 * 60 * 60 * 1000;
      }

      if (await assignmentManager.isUserBlocked(sender)) {
        const blockUntil = await assignmentManager.getUserBlockTime(sender);
        const body = `@${sender}, you are temporarily blocked from new assignments until ${new Date(blockUntil).toLocaleString()} due to a previous expired assignment.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
        return;
      }

      const activeCount = await assignmentManager.getUserActiveAssignmentCount(sender);
      if (activeCount >= 4) {
        await assignmentManager.addToQueue(sender, { repo, issue, duration });
        const body = `@${sender}, you have reached the maximum of 4 active assignments. This issue has been added to your queue and will be assigned once a slot is available.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
        return;
      }

      try {
        await context.octokit.issues.addAssignees({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          assignees: [sender]
        });
        const deadline = Date.now() + duration;
        await assignmentManager.addAssignment(repo, issue, sender, deadline);
        const body = `@${sender} has been assigned to this issue for ${duration / (60 * 60 * 1000)} hours. Deadline: ${new Date(deadline).toLocaleString()}.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
      } catch (error) {
        app.log.error(`Error assigning issue: ${error}`);
      }
    }
    // === /unassign Command ===
    else if (command.startsWith('/unassign')) {
      try {
        await context.octokit.issues.removeAssignees({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          assignees: [sender]
        });
        await assignmentManager.removeAssignment(repo, issue);
        const body = `@${sender} has been unassigned from this issue.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
        // Recheck the user's queue.
        await assignmentManager.processQueueForUser(sender, context.octokit);
      } catch (error) {
        app.log.error(`Error unassigning issue: ${error}`);
      }
    }
    // === /extend Command (maintainer-only) ===
    else if (command.startsWith('/extend-')) {
      const maintainers = ['maintainer1', 'maintainer2']; // Replace with real GitHub usernames.
      if (!maintainers.includes(sender)) {
        const body = `@${sender} is not authorized to extend assignment deadlines.`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
        return;
      }
      const regex = /\/extend-(\d+)([hm])/;
      const match = command.match(regex);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        let extension = 0;
        if (unit === 'h') {
          extension = value * 60 * 60 * 1000;
        } else if (unit === 'm') {
          extension = value * 60 * 1000;
        }
        const success = await assignmentManager.extendAssignment(repo, issue, extension);
        if (success) {
          const newDeadline = await assignmentManager.getAssignmentDeadline(repo, issue);
          const body = `The assignment deadline has been extended by ${value}${unit}. New deadline: ${new Date(newDeadline).toLocaleString()}.`;
          await context.octokit.issues.createComment({
            owner: repo.owner.login,
            repo: repo.name,
            issue_number: issue.number,
            body
          });
        } else {
          const body = `No active assignment found to extend.`;
          await context.octokit.issues.createComment({
            owner: repo.owner.login,
            repo: repo.name,
            issue_number: issue.number,
            body
          });
        }
      } else {
        const body = `Invalid extension format. Use /extend-<number><h or m> (e.g., /extend-1h).`;
        await context.octokit.issues.createComment({
          owner: repo.owner.login,
          repo: repo.name,
          issue_number: issue.number,
          body
        });
      }
    }
  });

  // Start the scheduler and register the pull request handler.
  startScheduler(app);
  registerPRHandler(app);
};
