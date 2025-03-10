import initDB from '../db/index.js';

// Helper: Add an assignment record.
async function addAssignment(repo, issue, user, deadline) {
  const db = await initDB();
  await db.run(
    `INSERT INTO assignments (repo, issue_number, assignee, deadline) VALUES (?, ?, ?, ?)`,
    [repo.full_name, issue.number, user, deadline]
  );
}

// Helper: Remove an assignment record.
async function removeAssignment(repo, issue) {
  const db = await initDB();
  await db.run(
    `DELETE FROM assignments WHERE repo = ? AND issue_number = ?`,
    [repo.full_name, issue.number]
  );
}

// Helper: Get an assignment record.
async function getAssignment(repo, issue) {
  const db = await initDB();
  return await db.get(
    `SELECT * FROM assignments WHERE repo = ? AND issue_number = ?`,
    [repo.full_name, issue.number]
  );
}

// Count active assignments for a user (assignment records are removed when issues close).
async function getUserActiveAssignmentCount(user) {
  const db = await initDB();
  const row = await db.get(
    `SELECT COUNT(*) as count FROM assignments WHERE assignee = ?`,
    [user]
  );
  return row ? row.count : 0;
}

// Check if a user is blocked for a specific issue.
async function isUserBlocked(repo, issue, user) {
  const db = await initDB();
  const row = await db.get(
    `SELECT blocked_until FROM blocked_users WHERE username = ? AND repo = ? AND issue_number = ?`,
    [user, repo.full_name, issue.number]
  );
  return row && Date.now() < row.blocked_until;
}

// Get the block expiration time for a specific issue.
async function getUserBlockTime(repo, issue, user) {
  const db = await initDB();
  const row = await db.get(
    `SELECT blocked_until FROM blocked_users WHERE username = ? AND repo = ? AND issue_number = ?`,
    [user, repo.full_name, issue.number]
  );
  return row ? row.blocked_until : 0;
}

// Block a user for a specific issue for a number of hours (default 3 hours).
async function blockUser(repo, issue, user, hours = 3) {
  const db = await initDB();
  const blocked_until = Date.now() + hours * 60 * 60 * 1000;
  await db.run(
    `INSERT OR REPLACE INTO blocked_users (username, repo, issue_number, blocked_until) VALUES (?, ?, ?, ?)`,
    [user, repo.full_name, issue.number, blocked_until]
  );
}

// Clear a user's block for a specific issue.
async function clearBlock(repo, issue, user) {
  const db = await initDB();
  await db.run(
    `DELETE FROM blocked_users WHERE username = ? AND repo = ? AND issue_number = ?`,
    [user, repo.full_name, issue.number]
  );
}

// Add an assignment to the user's queue.
async function addToQueue(user, assignment) {
  const db = await initDB();
  const { repo, issue, duration } = assignment;
  await db.run(
    `INSERT INTO user_queues (username, repo, issue_number, duration) VALUES (?, ?, ?, ?)`,
    [user, repo.full_name, issue.number, duration]
  );
}

// Process the queue for a given user.
// For each queued assignment, check if the issue is still open and not blocked for that user.
// If the issue is already assigned, update its created_at and increment retry_count to move it to the back of the queue.
// If retry_count exceeds the limit (3), the entry is removed to prevent infinite loops.
async function processQueueForUser(user, octokit) {
  const db = await initDB();
  let activeCount = await getUserActiveAssignmentCount(user);

  while (activeCount < 4) {
    const queuedAssignment = await db.get(
      `SELECT * FROM user_queues WHERE username = ? ORDER BY created_at LIMIT 1`,
      [user]
    );
    if (!queuedAssignment) break;

    // Reconstruct repository and issue objects.
    const repoParts = queuedAssignment.repo.split('/');
    const repo = {
      full_name: queuedAssignment.repo,
      name: repoParts[1],
      owner: { login: repoParts[0] }
    };
    const issue = { number: queuedAssignment.issue_number };

    // Check if the queued issue is still open.
    try {
      const { data: issueData } = await octokit.issues.get({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number
      });
      if (issueData.state !== 'open') {
        // Remove the queue entry if the issue is no longer open.
        await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
        continue;
      }

      // Check if the user is blocked from being assigned this specific issue.
      if (await isUserBlocked(repo, issue, user)) {
        // Skip processing this queued assignment.
        // Optionally, you can update created_at and retry_count or remove it after too many attempts.
        if (queuedAssignment.retry_count >= 3) {
          await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
        } else {
          await db.run(
            `UPDATE user_queues SET created_at = ?, retry_count = retry_count + 1 WHERE id = ?`,
            [Date.now(), queuedAssignment.id]
          );
        }
        continue;
      }

      // If the issue is already assigned to someone (and not to the queued user), then requeue it.
      if (issueData.assignees && issueData.assignees.length > 0) {
        if (queuedAssignment.retry_count >= 3) {
          await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
        } else {
          await db.run(
            `UPDATE user_queues SET created_at = ?, retry_count = retry_count + 1 WHERE id = ?`,
            [Date.now(), queuedAssignment.id]
          );
        }
        continue;
      }

      // Attempt to assign the queued issue.
      await octokit.issues.addAssignees({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number,
        assignees: [user]
      });
      const deadline = Date.now() + queuedAssignment.duration;
      await addAssignment(repo, issue, user, deadline);
      const body = `@${user} has been auto-assigned to this queued issue for ${queuedAssignment.duration / (60 * 60 * 1000)} hours. Deadline: ${new Date(deadline).toLocaleString()}.`;
      await octokit.issues.createComment({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number,
        body
      });
      // Remove the queue entry.
      await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
      activeCount = await getUserActiveAssignmentCount(user);
    } catch (error) {
      console.error(`Error processing queued assignment for ${user} (queue id: ${queuedAssignment.id}):`, error);
      if (error.status === 404) {
        await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
        continue;
      } else {
        await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
        continue;
      }
    }
  }
}

// Extend the deadline of an assignment.
async function extendAssignment(repo, issue, extension) {
  const db = await initDB();
  const assignment = await db.get(
    `SELECT * FROM assignments WHERE repo = ? AND issue_number = ?`,
    [repo.full_name, issue.number]
  );
  if (assignment) {
    const newDeadline = assignment.deadline + extension;
    await db.run(
      `UPDATE assignments SET deadline = ? WHERE id = ?`,
      [newDeadline, assignment.id]
    );
    return true;
  }
  return false;
}

// Get the current deadline for an assignment.
async function getAssignmentDeadline(repo, issue) {
  const db = await initDB();
  const assignment = await db.get(
    `SELECT deadline FROM assignments WHERE repo = ? AND issue_number = ?`,
    [repo.full_name, issue.number]
  );
  return assignment ? assignment.deadline : null;
}

// Get all active assignments.
async function getAllAssignments() {
  const db = await initDB();
  return await db.all(`SELECT * FROM assignments`);
}

// Get all users who have queued assignments.
async function getAllQueuedUsers() {
  const db = await initDB();
  const rows = await db.all(
    `SELECT DISTINCT username FROM user_queues`
  );
  return rows.map(row => row.username);
}

export const assignmentManager = {
  addAssignment,
  removeAssignment,
  getAssignment,
  getUserActiveAssignmentCount,
  isUserBlocked,
  getUserBlockTime,
  blockUser,
  clearBlock,
  addToQueue,
  processQueueForUser,
  extendAssignment,
  getAssignmentDeadline,
  getAllAssignments,
  getAllQueuedUsers
};
