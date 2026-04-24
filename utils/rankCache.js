const db = require('../config/db');

// ─── Ensure rank_cache table exists ──────────────────────────────────────────
// NOTE: `rank` is a MySQL reserved keyword — must be backtick-escaped everywhere.
const initRankCache = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS rank_cache (
      user_id      INT PRIMARY KEY,
      total_points INT NOT NULL DEFAULT 0,
      \`rank\`     INT NOT NULL DEFAULT 0,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_rc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
};

// Run once on module load
initRankCache().catch(console.error);

/**
 * Recalculate and persist global ranks for all students.
 * Uses a single INSERT … ON DUPLICATE KEY UPDATE so it is safe to call
 * concurrently and adds no row-locks beyond the rank_cache table itself.
 *
 * Call after any event_participation write (approve / bulk-generate).
 */
const refreshRankCache = async () => {
  try {
    await db.query(`
      INSERT INTO rank_cache (user_id, total_points, \`rank\`)
      SELECT
        u.id                                           AS user_id,
        COALESCE(SUM(ep.points), 0)                   AS total_points,
        RANK() OVER (
          ORDER BY COALESCE(SUM(ep.points), 0) DESC,
                   u.id ASC
        )                                              AS \`rank\`
      FROM users u
      LEFT JOIN event_participation ep ON ep.user_id = u.id
      WHERE u.role = 'student'
      GROUP BY u.id
      ON DUPLICATE KEY UPDATE
        total_points = VALUES(total_points),
        \`rank\`     = VALUES(\`rank\`),
        updated_at   = CURRENT_TIMESTAMP
    `);
  } catch (err) {
    // Non-fatal: log but do not crash the calling request
    console.error('[rankCache] refreshRankCache failed:', err.message);
  }
};

/**
 * Read rank + total_points for a single user from the cache.
 * Falls back to a live COUNT query if the cache row is missing
 * (e.g. first request before any refresh has run).
 *
 * @param {number} userId
 * @returns {{ rank: number, total_points: number }}
 */
const getRankFromCache = async (userId) => {
  const [rows] = await db.query(
    `SELECT \`rank\`, total_points FROM rank_cache WHERE user_id = ?`,
    [userId]
  );

  if (rows.length > 0) {
    return { rank: rows[0].rank, total_points: rows[0].total_points };
  }

  // ── Fallback: live calculation (only when cache is cold) ──────────────────
  const [pointsRows] = await db.query(
    `SELECT COALESCE(SUM(points), 0) AS total FROM event_participation WHERE user_id = ?`,
    [userId]
  );
  const total_points = parseInt(pointsRows[0].total) || 0;

  const [rankRows] = await db.query(
    `SELECT COUNT(*) + 1 AS \`rank\`
     FROM (
       SELECT u.id, COALESCE(SUM(ep.points), 0) AS live_total
       FROM users u
       LEFT JOIN event_participation ep ON u.id = ep.user_id
       WHERE u.role = 'student'
       GROUP BY u.id
     ) AS rankings
     WHERE live_total > ? OR (live_total = ? AND id < ?)`,
    [total_points, total_points, userId]
  );

  // Trigger a background cache warm-up so next call hits the cache
  refreshRankCache();

  return { rank: rankRows[0].rank, total_points };
};

module.exports = { refreshRankCache, getRankFromCache };
