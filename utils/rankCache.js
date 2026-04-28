const db = require('../config/db');

// We no longer maintain a separate rank_cache table.
// All rankings are computed dynamically from leaderboard_cache.

const refreshRankCache = async () => {
  // Deprecated: Ranking is now directly derived from leaderboard_cache.
  // Kept here to avoid breaking existing imports.
};

const getRankFromCache = async (userId) => {
  const [rows] = await db.query(
    `WITH RankedUsers AS (
      SELECT
        user_id,
        SUM(total_points) AS total_points,
        ROW_NUMBER() OVER (
          ORDER BY 
            SUM(total_points) DESC, 
            MIN(first_achievement_date) ASC, 
            MIN(min_submission_at) ASC, 
            user_id ASC
        ) AS \`rank\`
      FROM leaderboard_cache
      GROUP BY user_id
      HAVING total_points > 0
    )
    SELECT \`rank\`, total_points FROM RankedUsers WHERE user_id = ?`,
    [userId]
  );

  if (rows.length > 0) {
    return { rank: rows[0].rank, total_points: parseInt(rows[0].total_points) || 0 };
  }

  // Fallback if not ranked yet or 0 points
  const [pointsRows] = await db.query(
    `SELECT COALESCE(SUM(points), 0) AS total FROM event_participation WHERE user_id = ?`,
    [userId]
  );
  const total_points = parseInt(pointsRows[0].total) || 0;

  return { rank: null, total_points };
};

module.exports = { refreshRankCache, getRankFromCache };
