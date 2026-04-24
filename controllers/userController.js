const db = require('../config/db');
const { getRankFromCache } = require('../utils/rankCache');

/**
 * @desc    Get user profile data for dashboard
 * @route   GET /api/users/profile
 * @access  Private
 */
const getUserProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Basic User Info
    const [userRows] = await db.query(
      'SELECT id, name, erp, email, course, branch, semester, college, role, avatar_url FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRows[0];

    // 2 & 3. Rank + Total Points — read from rank_cache (O(1) indexed lookup).
    //         Cache is refreshed automatically after any points write.
    //         Falls back to a live query on first request (cache cold start).
    const { rank, total_points } = await getRankFromCache(userId);

    // 4. Certificates List (Unified & Cross-referenced with event_participation)
    const [manualApproved] = await db.query(
      'SELECT id, club_id, event_name, event_date, position, points, file_url as url, "manual" as source, created_at FROM certificates WHERE user_id = ? AND status = "approved"',
      [userId]
    );

    const [eCerts] = await db.query(
      'SELECT id, club_id, event_name, event_date, position, points, certificate_url as url, "e_certificate" as source, created_at FROM e_certificates WHERE user_id = ?',
      [userId]
    );

    const [participations] = await db.query(
      'SELECT club_id, event_name, event_date, source FROM event_participation WHERE user_id = ?',
      [userId]
    );

    const matchParticipation = (clubId, eventName, eventDate) => {
      return participations.find(p => 
        p.club_id === clubId &&
        p.event_name.toLowerCase() === eventName.toLowerCase() &&
        new Date(p.event_date).getTime() === new Date(eventDate).getTime()
      );
    };

    const rawCertificates = [...manualApproved, ...eCerts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const certificates = rawCertificates.map(cert => {
      const p = matchParticipation(cert.club_id, cert.event_name, cert.event_date);
      const isCounted = p ? p.source === cert.source : false;
      const winningSource = p ? p.source : null;
      
      return {
        id: cert.id,
        event_name: cert.event_name,
        position: cert.position,
        points: cert.points,
        url: cert.url,
        source: cert.source,
        created_at: cert.created_at,
        isCounted,
        winningSource
      };
    });

    // 5. Monthly Stats for Graph
    const [monthlyStats] = await db.query(`
      SELECT 
        MONTHNAME(event_date) as month, 
        CAST(SUM(points) AS SIGNED) as points 
      FROM event_participation 
      WHERE user_id = ? 
      GROUP BY MONTH(event_date), MONTHNAME(event_date)
      ORDER BY MONTH(event_date)
    `, [userId]);

    // Extra data for existing frontend components
    const [manualHistory] = await db.query(
      `SELECT c.*, cl.name as club_name 
       FROM certificates c
       LEFT JOIN clubs cl ON c.club_id = cl.id
       WHERE c.user_id = ? 
       ORDER BY c.created_at DESC`,
      [userId]
    );

    const [counts] = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM event_participation WHERE user_id = ?) as approvedCount,
        (SELECT COUNT(*) FROM certificates WHERE user_id = ? AND status = 'pending') as pendingCount,
        (SELECT COUNT(*) FROM e_certificates WHERE user_id = ?) as eCertsCount
      `,
      [userId, userId, userId]
    );

    const { approvedCount, pendingCount, eCertsCount } = counts[0];

    const [activityLogs] = await db.query(
      'SELECT action_type, metadata, created_at FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [userId]
    );

    res.status(200).json({
      success: true,
      data: {
        user: { ...user, total_points },
        total_points, // Ensure top level as requested too
        rank,
        certificates,
        monthly_stats: monthlyStats, // Alias for requested name
        monthlyStats,
        approvedCount,
        pendingCount,
        eCertsCount,
        activityLogs,
        manualHistory
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update user profile (branch/semester)
 * @route   PUT /api/users/profile
 * @access  Private
 */
const updateProfile = async (req, res, next) => {
  try {
    const { course, branch, semester, college } = req.body;
    const userId = req.user.id;

    await db.query(
      'UPDATE users SET course = ?, branch = ?, semester = ?, college = ? WHERE id = ?',
      [course, branch, semester, college, userId]
    );

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload avatar image
 * @route   POST /api/users/avatar
 * @access  Private
 */
const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const userId = req.user.id;
    const avatarPath = `/uploads/avatars/${req.file.filename}`;

    await db.query(
      'UPDATE users SET avatar_url = ? WHERE id = ?',
      [avatarPath, userId]
    );

    res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatar_url: avatarPath
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getUserProfile,
  updateProfile,
  uploadAvatar
};
