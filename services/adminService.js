const db = require('../config/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notificationHelper');
const { refreshRankCache } = require('../utils/rankCache');
const { refreshLeaderboardCache } = require('./leaderboardService');

// Centralized points map — single source of truth for this service
const POINTS_MAP = {
  winner: 100,
  runnerup1: 75,
  runnerup2: 50,
  participant: 20
};

const getPoints = (position) => POINTS_MAP[position] || 0;

/**
 * Get aggregated statistics for the admin dashboard
 */
const getAdminStats = async (club_id) => {
  const [stats] = await db.query(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
     FROM certificates 
     WHERE club_id = ?`,
    [club_id]
  );
  return stats[0];
};

/**
 * Approve a certificate and update user points
 */
const approveCertificate = async (certId, adminId) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const [certs] = await connection.query(
      'SELECT * FROM certificates WHERE id = ? FOR UPDATE', 
      [certId]
    );
    
    if (!certs.length) throw new Error('Certificate not found');
    const cert = certs[0];

    if (cert.status !== 'pending') throw new Error('Certificate is already processed');

    const points = getPoints(cert.position);

    // 1. Update certificate status
    await connection.query(
      'UPDATE certificates SET status = "approved", points = ?, verified_by = ? WHERE id = ?',
      [points, adminId, certId]
    );

    // 2. Add to event_participation (Source of truth)
    await connection.query(
      `INSERT INTO event_participation (user_id, club_id, event_name, event_date, position, source, points)
       VALUES (?, ?, ?, ?, ?, "manual", ?)
       ON DUPLICATE KEY UPDATE points = ?`,
      [cert.user_id, cert.club_id, cert.event_name, cert.event_date, cert.position, points, points]
    );

    // 3. Update user's total points
    await connection.query(
      'UPDATE users SET total_points = total_points + ? WHERE id = ?',
      [points, cert.user_id]
    );

    await connection.commit();

    // Refresh both caches after points change (non-blocking)
    refreshRankCache();
    refreshLeaderboardCache();

    createNotification(cert.user_id, `Your certificate for ${cert.event_name} has been approved! +${points} points.`, 'success');
    logActivity(adminId, 'APPROVE_CERTIFICATE', certId, { user_id: cert.user_id, points });

    return { success: true, points };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const rejectCertificate = async (certId, adminId) => {
  const [certs] = await db.query('SELECT * FROM certificates WHERE id = ?', [certId]);
  if (!certs.length) throw new Error('Certificate not found');
  
  await db.query('UPDATE certificates SET status = "rejected", verified_by = ? WHERE id = ?', [adminId, certId]);
  
  createNotification(certs[0].user_id, `Your certificate for ${certs[0].event_name} was rejected.`, 'warning');
  logActivity(adminId, 'REJECT_CERTIFICATE', certId, { user_id: certs[0].user_id });
  
  return { success: true };
};

module.exports = { getAdminStats, approveCertificate, rejectCertificate, getPoints };
