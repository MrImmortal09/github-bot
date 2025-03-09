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

// Count active assignments for a user (assignments records are removed when issues close).
async function getUserActiveAssignmentCount(user) {
  const db = await initDB();
  const row = await db.get(
    `SELECT COUNT(*) as count FROM assignments WHERE assignee = ?`,
    [user]
  );
  return row ? row.count : 0;
}

// Check if a user is blocked.
async function isUserBlocked(user) {
  const db = await initDB();
  const row = await db.get(
    `SELECT blocked_until FROM blocked_users WHERE username = ?`,
    [user]
  );
  return row && Date.now() < row.blocked_until;
}

// Get the block expiration time.
async function getUserBlockTime(user) {
  const db = await initDB();
  const row = await db.get(
    `SELECT blocked_until FROM blocked_users WHERE username = ?`,
    [user]
  );
  return row ? row.blocked_until : 0;
}

// Block a user for a number of hours.
async function blockUser(user, hours = 5) {
  const db = await initDB();
  const blocked_until = Date.now() + hours * 60 * 60 * 1000;
  await db.run(
    `INSERT OR REPLACE INTO blocked_users (username, blocked_until) VALUES (?, ?)`,
    [user, blocked_until]
  );
}

// Clear a user's block.
async function clearBlock(user) {
  const db = await initDB();
  await db.run(
    `DELETE FROM blocked_users WHERE username = ?`,
    [user]
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
// Before assigning, check that the queued issue is still open.
// If the issue is already assigned to someone, update its created_at and increment retry_count to move it to the back of the queue.
// If retry_count exceeds the limit (3), the entry is removed to prevent infinite loops.
async function processQueueForUser(user, octokit) {
  if (await isUserBlocked(user)) return;

  const db = await initDB();
  let activeCount = await getUserActiveAssignmentCount(user);

  while (activeCount < 4) {
    const queuedAssignment = await db.get(
      `SELECT * FROM user_queues WHERE username = ? ORDER BY created_at LIMIT 1`,
      [user]
    );
    if (!queuedAssignment) break;

    try {
      // Reconstruct repository and issue objects.
      const repoParts = queuedAssignment.repo.split('/');
      const repo = {
        full_name: queuedAssignment.repo,
        name: repoParts[1],
        owner: { login: repoParts[0] }
      };
      const issue = { number: queuedAssignment.issue_number };

      // Check if the queued issue is still open.
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

      // If the issue is already assigned to someone (and not to the queued user),
      // then requeue it by updating created_at and incrementing retry_count.
      if (issueData.assignees && issueData.assignees.length > 0) {
        if (queuedAssignment.retry_count >= 3) {
          // Too many requeue attempts; remove the record.
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
      // If the error indicates the issue is not found (e.g., 404), remove the queue entry.
      if (error.status === 404) {
        await db.run(`DELETE FROM user_queues WHERE id = ?`, [queuedAssignment.id]);
        continue;
      } else {
        // For other errors, remove the queue entry to prevent infinite looping.
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
