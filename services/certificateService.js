const db = require('../config/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notificationHelper');
const crypto = require('crypto');
const { refreshRankCache } = require('../utils/rankCache');
const { refreshLeaderboardCache } = require('./leaderboardService');

/**
 * Generate a unique certificate ID
 */
const generateCertId = () => {
  return `CR-${Date.now().toString().slice(-7)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

/**
 * Bulk generate e-certificates for a list of students
 */
const bulkGenerate = async (club_id, event_name, event_date, students, adminId) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const results = [];
    const erps = students.map(s => s.erp);
    
    // 1. Fetch all users in one query to avoid N+1
    const [users] = await connection.query(
      'SELECT id, erp, name FROM users WHERE erp IN (?)',
      [erps]
    );
    const userMap = users.reduce((acc, u) => ({ ...acc, [u.erp]: u }), {});

    for (const student of students) {
      const user = userMap[student.erp];
      if (!user) continue;

      const certId = generateCertId();
      const points = 20; // Default participant points

      // 2. Insert into event_participation
      await connection.query(
        `INSERT INTO event_participation (user_id, club_id, event_name, event_date, position, source, points)
         VALUES (?, ?, ?, ?, ?, "e_certificate", ?)
         ON DUPLICATE KEY UPDATE points = points`,
        [user.id, club_id, event_name, event_date, student.position || 'participant', points]
      );

      results.push({ user_id: user.id, name: user.name, certId });
    }

    await connection.commit();

    // Refresh both caches after bulk points change (non-blocking)
    refreshRankCache();
    refreshLeaderboardCache();

    logActivity(adminId, 'BULK_GENERATE_CERTIFICATES', null, { event_name, count: results.length });
    return results;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { bulkGenerate, generateCertId };
