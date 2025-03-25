import pool from '../db/index.js';

async function addAssignment(repo, issue, user, deadline) {
  const query = `
    INSERT INTO assignments (repo, issue_number, assignee, deadline)
    VALUES ($1, $2, $3, $4)
  `;
  const values = [repo.full_name, issue.number, user, deadline];
  await pool.query(query, values);
}

async function removeAssignment(repo, issue) {
  const query = `
    DELETE FROM assignments WHERE repo = $1 AND issue_number = $2
  `;
  const values = [repo.full_name, issue.number];
  await pool.query(query, values);
}

async function getAssignment(repo, issue) {
  const query = `
    SELECT * FROM assignments WHERE repo = $1 AND issue_number = $2
  `;
  const values = [repo.full_name, issue.number];
  const result = await pool.query(query, values);
  return result.rows[0];
}

async function getUserActiveAssignmentCount(user) {
  const query = `
    SELECT COUNT(*) AS count FROM assignments WHERE assignee = $1
  `;
  const values = [user];
  const result = await pool.query(query, values);
  return result.rows.length > 0 ? parseInt(result.rows[0].count, 10) : 0;
}

async function isUserBlocked(repo, issue, user) {
  const query = `
    SELECT blocked_until FROM blocked_users
    WHERE username = $1 AND repo = $2 AND issue_number = $3
  `;
  const values = [user, repo.full_name, issue.number];
  const result = await pool.query(query, values);
  if (result.rows.length > 0) {
    return Date.now() < result.rows[0].blocked_until;
  }
  return false;
}

async function getUserBlockTime(repo, issue, user) {
  const query = `
    SELECT blocked_until FROM blocked_users
    WHERE username = $1 AND repo = $2 AND issue_number = $3
  `;
  const values = [user, repo.full_name, issue.number];
  const result = await pool.query(query, values);
  return result.rows.length > 0 ? result.rows[0].blocked_until : 0;
}

async function blockUser(repo, issue, user, hours = 3) {
  const blocked_until = Date.now() + hours * 60 * 60 * 1000;
  const query = `
    INSERT INTO blocked_users (username, repo, issue_number, blocked_until)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (username, repo, issue_number)
    DO UPDATE SET blocked_until = EXCLUDED.blocked_until
  `;
  const values = [user, repo.full_name, issue.number, blocked_until];
  await pool.query(query, values);
}

async function clearBlock(repo, issue, user) {
  const query = `
    DELETE FROM blocked_users WHERE username = $1 AND repo = $2 AND issue_number = $3
  `;
  const values = [user, repo.full_name, issue.number];
  await pool.query(query, values);
}

async function addToQueue(user, assignment) {
  const { repo, issue, duration } = assignment;
  const query = `
    INSERT INTO user_queues (username, repo, issue_number, duration)
    VALUES ($1, $2, $3, $4)
  `;
  const values = [user, repo.full_name, issue.number, duration];
  await pool.query(query, values);
}

async function processQueueForUser(user, octokit) {
  let activeCount = await getUserActiveAssignmentCount(user);

  while (activeCount < 4) {
    const queueQuery = `
      SELECT * FROM user_queues WHERE username = $1 ORDER BY created_at LIMIT 1
    `;
    const queueResult = await pool.query(queueQuery, [user]);
    const queuedAssignment = queueResult.rows[0];
    if (!queuedAssignment) break;

    const repoParts = queuedAssignment.repo.split('/');
    const repo = {
      full_name: queuedAssignment.repo,
      name: repoParts[1],
      owner: { login: repoParts[0] }
    };
    const issue = { number: queuedAssignment.issue_number };

    try {
      const { data: issueData } = await octokit.issues.get({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number
      });
      if (issueData.state !== 'open') {
        // Remove the queue entry if the issue is no longer open.
        await pool.query(`DELETE FROM user_queues WHERE id = $1`, [queuedAssignment.id]);
        continue;
      }

      // Check if the user is blocked for this issue.
      if (await isUserBlocked(repo, issue, user)) {
        if (queuedAssignment.retry_count >= 3) {
          await pool.query(`DELETE FROM user_queues WHERE id = $1`, [queuedAssignment.id]);
        } else {
          await pool.query(
            `UPDATE user_queues SET created_at = $1, retry_count = retry_count + 1 WHERE id = $2`,
            [Date.now(), queuedAssignment.id]
          );
        }
        continue;
      }

      // If the issue is already assigned, requeue it.
      if (issueData.assignees && issueData.assignees.length > 0) {
        if (queuedAssignment.retry_count >= 3) {
          await pool.query(`DELETE FROM user_queues WHERE id = $1`, [queuedAssignment.id]);
        } else {
          await pool.query(
            `UPDATE user_queues SET created_at = $1, retry_count = retry_count + 1 WHERE id = $2`,
            [Date.now(), queuedAssignment.id]
          );
        }
        continue;
      }

      // Attempt assignment.
      await octokit.issues.addAssignees({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number,
        assignees: [user]
      });
      const deadline = Date.now() + queuedAssignment.duration;
      await addAssignment(repo, issue, user, deadline);
      const body = `@${user} has been auto-assigned to this queued issue for ${
        queuedAssignment.duration / (60 * 60 * 1000)
      } hours. Deadline: ${new Date(deadline).toLocaleString()}.`;
      await octokit.issues.createComment({
        owner: repo.owner.login,
        repo: repo.name,
        issue_number: issue.number,
        body
      });
      // Remove the processed queue entry.
      await pool.query(`DELETE FROM user_queues WHERE id = $1`, [queuedAssignment.id]);
      activeCount = await getUserActiveAssignmentCount(user);
    } catch (error) {
      console.error(
        `Error processing queued assignment for ${user} (queue id: ${queuedAssignment.id}):`,
        error
      );
      if (error.status === 404) {
        await pool.query(`DELETE FROM user_queues WHERE id = $1`, [queuedAssignment.id]);
      } else {
        await pool.query(`DELETE FROM user_queues WHERE id = $1`, [queuedAssignment.id]);
      }
      continue;
    }
  }
}

async function extendAssignment(repo, issue, extension) {
  const querySelect = `
    SELECT * FROM assignments WHERE repo = $1 AND issue_number = $2
  `;
  const valuesSelect = [repo.full_name, issue.number];
  const result = await pool.query(querySelect, valuesSelect);
  const assignment = result.rows[0];
  if (assignment) {
    const newDeadline = assignment.deadline + extension;
    const queryUpdate = `
      UPDATE assignments SET deadline = $1 WHERE id = $2
    `;
    await pool.query(queryUpdate, [newDeadline, assignment.id]);
    return true;
  }
  return false;
}

async function getAssignmentDeadline(repo, issue) {
  const query = `
    SELECT deadline FROM assignments WHERE repo = $1 AND issue_number = $2
  `;
  const values = [repo.full_name, issue.number];
  const result = await pool.query(query, values);
  return result.rows.length > 0 ? result.rows[0].deadline : null;
}

async function getAllAssignments() {
  const result = await pool.query(`SELECT * FROM assignments`);
  return result.rows;
}

async function getAllQueuedUsers() {
  const result = await pool.query(`SELECT DISTINCT username FROM user_queues`);
  return result.rows.map(row => row.username);
}

async function updateScore(user, score) {
  const query = `
    INSERT INTO user_points (username, points)
    VALUES ($1, $2)
    ON CONFLICT (username)
    DO UPDATE SET points = user_points.points + $2
  `;
  const values = [user, score];
  const result = await pool.query(query, values);
  return result;
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
  getAllQueuedUsers,
  updateScore
};
