const db = require('../config/db');

/**
 * Ensure leaderboard_cache exists on startup.
 */
const initLeaderboardCache = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS leaderboard_cache (
        user_id INT,
        club_id INT,
        total_points INT,
        month INT,
        year INT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, club_id, month, year),
        CONSTRAINT fk_lc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_lc_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      )
    `);
    // Warm it up immediately if empty
    const [rows] = await db.query('SELECT 1 FROM leaderboard_cache LIMIT 1');
    if (rows.length === 0) {
      console.log('[leaderboardCache] Table is empty, warming up...');
      await refreshLeaderboardCache();
    }
  } catch (err) {
    console.error('[leaderboardCache] Initialization failed:', err.message);
  }
};

initLeaderboardCache();


// ─── Cache Refresh ─────────────────────────────────────────────────────────
/**
 * Rebuild leaderboard_cache from event_participation.
 * Groups by (user_id, club_id, month, year) to match the cache PK.
 * Safe to call concurrently — uses INSERT … ON DUPLICATE KEY UPDATE.
 * Called after any event_participation write (approve / bulk-generate).
 */
const refreshLeaderboardCache = async () => {
  try {
    await db.query(`
      INSERT INTO leaderboard_cache (user_id, club_id, month, year, total_points)
      SELECT
        ep.user_id,
        ep.club_id,
        MONTH(ep.event_date)  AS month,
        YEAR(ep.event_date)   AS year,
        SUM(ep.points)        AS total_points
      FROM event_participation ep
      JOIN users u ON u.id = ep.user_id
      WHERE u.role = 'student'
      GROUP BY ep.user_id, ep.club_id, MONTH(ep.event_date), YEAR(ep.event_date)
      ON DUPLICATE KEY UPDATE
        total_points = VALUES(total_points),
        updated_at   = CURRENT_TIMESTAMP
    `);
  } catch (err) {
    console.error('[leaderboardCache] refresh failed:', err.message);
  }
};

// ─── Cache Read ────────────────────────────────────────────────────────────
/**
 * Build WHERE clauses for leaderboard_cache queries.
 */
const buildCacheWhere = (type, club_id, filter) => {
  const clauses = [];
  const params = [];

  if (type === 'club' && club_id && club_id !== '0') {
    clauses.push('lc.club_id = ?');
    params.push(club_id);
  }

  if (filter === 'monthly') {
    clauses.push('lc.month = MONTH(CURRENT_DATE()) AND lc.year = YEAR(CURRENT_DATE())');
  } else if (filter === 'yearly') {
    clauses.push('lc.year = YEAR(CURRENT_DATE())');
  }

  return {
    whereStr: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

/**
 * Fetch leaderboard from leaderboard_cache.
 * Returns null if the cache is empty (triggers fallback).
 */
const getFromCache = async (type, club_id, filter, offset, limit) => {
  const { whereStr, params } = buildCacheWhere(type, club_id, filter);

  const cacheQuery = `
    SELECT
      u.id, u.name, u.erp, u.avatar_url,
      SUM(lc.total_points) AS total_points
    FROM leaderboard_cache lc
    JOIN users u ON u.id = lc.user_id
    ${whereStr}
    GROUP BY u.id, u.name, u.erp, u.avatar_url
    ORDER BY total_points DESC, u.id ASC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(DISTINCT lc.user_id) AS total
    FROM leaderboard_cache lc
    JOIN users u ON u.id = lc.user_id
    ${whereStr}
  `;

  try {
    const [rows] = await db.query(cacheQuery, [...params, parseInt(limit), parseInt(offset)]);
    const [countResult] = await db.query(countQuery, params);

    // If cache is completely empty, signal fallback
    if (countResult[0].total === 0) return null;

    return {
      data: rows.map((row, index) => ({
        rank: offset + index + 1,
        ...row,
        total_points: parseInt(row.total_points) || 0,
      })),
      total: countResult[0].total,
    };
  } catch (err) {
    console.error('[leaderboardCache] getFromCache error:', err.message);
    return null; // Force fallback to live query on any cache error
  }
};

// ─── Live Fallback ─────────────────────────────────────────────────────────
/**
 * Original live query against event_participation.
 * Used only when leaderboard_cache is empty (cold start / first boot).
 */
const getFromLive = async (type, club_id, filter, offset, limit) => {
  let params = [];

  let baseQuery = `
    FROM event_participation ep
    JOIN users u ON u.id = ep.user_id
  `;

  let whereClauses = [`u.role = 'student'`];

  if (type === 'club' && club_id && club_id !== '0') {
    whereClauses.push(`ep.club_id = ?`);
    params.push(club_id);
  }

  if (filter === 'monthly') {
    whereClauses.push(`MONTH(ep.event_date) = MONTH(CURRENT_DATE()) AND YEAR(ep.event_date) = YEAR(CURRENT_DATE())`);
  } else if (filter === 'yearly') {
    whereClauses.push(`YEAR(ep.event_date) = YEAR(CURRENT_DATE())`);
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';

  const query = `
    SELECT u.id, u.name, u.erp, u.avatar_url, SUM(ep.points) as total_points
    ${baseQuery}
    ${whereStr}
    GROUP BY u.id, u.name, u.erp, u.avatar_url
    ORDER BY total_points DESC, u.id ASC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(DISTINCT ep.user_id) as total
    ${baseQuery}
    ${whereStr}
  `;

  const [rows] = await db.query(query, [...params, parseInt(limit), parseInt(offset)]);
  const [countResult] = await db.query(countQuery, params);

  // Warm the cache in the background so next request hits it
  refreshLeaderboardCache();

  return {
    data: rows.map((row, index) => ({
      rank: offset + index + 1,
      ...row,
      total_points: parseInt(row.total_points) || 0,
    })),
    total: countResult[0].total,
  };
};

// ─── Main Entry Point ──────────────────────────────────────────────────────
/**
 * Get leaderboard data — cache-first, live fallback.
 * @param {'global'|'club'} type
 * @param {number|null} club_id
 * @param {'overall'|'monthly'|'yearly'} filter
 * @param {number} page
 * @param {number} limit
 */
const getLeaderboardData = async (type, club_id, filter, page = 1, limit = 50) => {
  const offset = (page - 1) * limit;

  // 1. Try cache first
  const cached = await getFromCache(type, club_id, filter, offset, limit);
  if (cached) return cached;

  // 2. Cache empty → fall back to live query + trigger background warm-up
  return getFromLive(type, club_id, filter, offset, limit);
};

module.exports = { getLeaderboardData, refreshLeaderboardCache };
