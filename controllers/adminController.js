const db = require('../config/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notificationHelper');
const { updateLeaderboardCache } = require('../utils/leaderboardCache');

/**
 * @desc    Get all pending certificates
 * @route   GET /api/admin/certificates
 * @access  Private (Admin/Superadmin)
 */
const getPendingCertificates = async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;

    let query = '';
    let params = [];

    // 1. Determine which certificates to show based on role
    if (role === 'superadmin') {
      query = `
        SELECT c.*, u.name as user_name, u.erp as user_erp, cl.name as club_name
        FROM certificates c
        JOIN users u ON c.user_id = u.id
        JOIN clubs cl ON c.club_id = cl.id
        WHERE c.status = 'pending'
        ORDER BY c.created_at ASC
      `;
    } else if (role === 'admin') {
      // First, get the admin's club_id
      const [admins] = await db.query('SELECT club_id FROM users WHERE id = ?', [userId]);
      const adminClubId = admins[0]?.club_id;

      if (!adminClubId) {
        // If an admin is not attached to a club, they just see no certificates rather than a 403 error
        return res.status(200).json({
          success: true,
          count: 0,
          data: [],
          message: 'No club assigned to this admin'
        });
      }

      query = `
        SELECT c.*, u.name as user_name, u.erp as user_erp, cl.name as club_name
        FROM certificates c
        JOIN users u ON c.user_id = u.id
        JOIN clubs cl ON c.club_id = cl.id
        WHERE c.status = 'pending' AND c.club_id = ?
        ORDER BY c.created_at ASC
      `;
      params.push(adminClubId);
    } else {
      res.status(403);
      throw new Error('Access denied: Unauthorized role');
    }

    const [certificates] = await db.query(query, params);

    const getPoints = (position) => {
      switch(position) {
        case "winner": return 50;
        case "runnerup1": return 35;
        case "runnerup2": return 20;
        default: return 10;
      }
    };

    const enhancedCertificates = certificates.map(cert => ({
      ...cert,
      default_points: getPoints(cert.position)
    }));

    res.status(200).json({
      success: true,
      count: enhancedCertificates.length,
      data: enhancedCertificates
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve a certificate and award points
 * @route   PUT /api/admin/approve/:id
 * @access  Private (Admin/Superadmin)
 */
const approveCertificate = async (req, res, next) => {
  // Use a MySQL transaction because we update multiple rows/tables (certs + users) synchronously
  const connection = await db.getConnection(); 
  
  try {
    const certificateId = req.params.id;
    const { id: adminId, role } = req.user; // Admin performing the action

    await connection.beginTransaction();

    // 1. Find the certificate and lock the row for update
    const [certs] = await connection.query(
      'SELECT * FROM certificates WHERE id = ? FOR UPDATE',
      [certificateId]
    );

    if (certs.length === 0) {
      res.status(404);
      throw new Error('Certificate not found');
    }

    const certificate = certs[0];

    // Check permissions: superadmin can alter any, admin can only alter their own club
    if (role === 'admin') {
      const [admins] = await connection.query('SELECT club_id FROM users WHERE id = ?', [adminId]);
      const adminClubId = admins[0]?.club_id;
      if (certificate.club_id !== adminClubId) {
        res.status(403);
        throw new Error('Unauthorized to approve certificates for other clubs');
      }
    }

    // 2. Prevent re-approving or modifying resolved certificates
    if (certificate.status !== 'pending') {
      res.status(400);
      throw new Error(`Certificate is already ${certificate.status}`);
    }

    // 3. Assign points based on position or custom override
    const getPoints = (position) => {
      switch(position) {
        case "winner": return 50;
        case "runnerup1": return 35;
        case "runnerup2": return 20;
        default: return 10;
      }
    };

    const defaultPoints = getPoints(certificate.position);
    const finalPoints = req.body.points && !isNaN(req.body.points) 
      ? parseInt(req.body.points) 
      : defaultPoints;

    // 4. Update the certificate status, points, and verified_by fields
    const updateCertQuery = `
      UPDATE certificates
      SET status = 'approved', points = ?, verified_by = ?
      WHERE id = ?
    `;
    await connection.query(updateCertQuery, [finalPoints, adminId, certificateId]);

    // 5. INSERT INTO event_participation (Centralized Points Control)
    // For manual upload, we use IGNORE. If it already exists (from e-cert or previous manual), affectedRows will be 0.
    const insertParticipationQuery = `
      INSERT IGNORE INTO event_participation 
      (user_id, club_id, event_name, event_date, position, source, points)
      VALUES (?, ?, ?, ?, ?, 'manual', ?)
    `;
    const [result] = await connection.query(insertParticipationQuery, [
      certificate.user_id,
      certificate.club_id,
      certificate.event_name || 'Legacy Event',
      certificate.event_date,
      certificate.position,
      finalPoints
    ]);

    // Commit all changes
    await connection.commit();

    // 6. Update the user's total points securely (Redundancy sync)
    await db.query(
      `UPDATE users 
       SET total_points = (SELECT SUM(points) FROM event_participation WHERE user_id = ?) 
       WHERE id = ?`, 
      [certificate.user_id, certificate.user_id]
    );

    // 7. ASYNC TASKS: Log, Notify, and Refresh Cache
    logActivity(adminId, 'VERIFY_CERT', certificateId, { points: finalPoints, user_id: certificate.user_id });
    
    // ONLY update cache and notify with points if this was a NEW participation record (prevent double counting)
    if (result.affectedRows > 0) {
      createNotification(certificate.user_id, `Your certificate for ${certificate.event_name || 'Event'} has been approved! 🎉 (+${finalPoints} points added)`, 'success', 'Certificate Approved');
      updateLeaderboardCache(certificate.user_id, certificate.club_id, finalPoints, certificate.event_date);
    } else {
      createNotification(certificate.user_id, `Your certificate for ${certificate.event_name || 'Event'} has been approved! 🏆 (Points were not added because this event was already counted)`, 'success', 'Certificate Approved');
    }

    res.status(200).json({
      success: true,
      message: 'Certificate approved and points awarded',
      data: {
        certificateId,
        awardedPoints: finalPoints
      }
    });

  } catch (error) {
    // If any error occurs, rollback the whole process
    await connection.rollback();
    next(error);
  } finally {
    // Always release the connection block
    connection.release();
  }
};

/**
 * @desc    Reject a certificate
 * @route   PUT /api/admin/reject/:id
 * @access  Private (Admin/Superadmin)
 */
const rejectCertificate = async (req, res, next) => {
  try {
    const certificateId = req.params.id;
    const { id: adminId, role } = req.user;

    // Find the certificate
    const [certs] = await db.query(
      'SELECT id, status, club_id FROM certificates WHERE id = ?',
      [certificateId]
    );

    if (certs.length === 0) {
      res.status(404);
      throw new Error('Certificate not found');
    }

    const certificate = certs[0];

    // Check permissions
    if (role === 'admin') {
      const [admins] = await db.query('SELECT club_id FROM users WHERE id = ?', [adminId]);
      const adminClubId = admins[0]?.club_id;
      if (certificate.club_id !== adminClubId) {
        res.status(403);
        throw new Error('Unauthorized to reject certificates for other clubs');
      }
    }

    if (certificate.status !== 'pending') {
      res.status(400);
      throw new Error(`Certificate is already ${certificate.status}`);
    }

    // Update the certificate status to rejected
    const updateQuery = `
      UPDATE certificates
      SET status = 'rejected', verified_by = ?
      WHERE id = ?
    `;
    
    await db.query(updateQuery, [adminId, certificateId]);

    // ASYNC TASKS: Log and Notify
    logActivity(adminId, 'REJECT_CERT', certificateId, { user_id: certificate.user_id });
    createNotification(certificate.user_id, `Your certificate for ${certificate.event_name || 'Event'} was rejected. ❌ Please contact the club admin.`, 'warning', 'Certificate Rejected');

    res.status(200).json({
      success: true,
      message: 'Certificate has been rejected'
    });
  } catch (error) {
    next(error);
  }
};

const getAdminStats = async (req, res, next) => {
  try {
    const { id: adminId, role } = req.user;
    
    if (role === 'superadmin') {
      const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM certificates');
      const [[{ pending }]] = await db.query('SELECT COUNT(*) as pending FROM certificates WHERE status = "pending"');
      const [[{ approved }]] = await db.query('SELECT COUNT(*) as approved FROM certificates WHERE status = "approved"');
      const [[{ eCertificates }]] = await db.query('SELECT COUNT(*) as eCertificates FROM e_certificates');
      return res.json({ success: true, data: { total, pending, approved, eCertificates } });
    }

    const [admins] = await db.query('SELECT club_id FROM users WHERE id = ?', [adminId]);
    const adminClubId = admins[0]?.club_id;
    if (!adminClubId) return res.json({ success: true, data: { total: 0, pending: 0, approved: 0, eCertificates: 0 }});

    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM certificates WHERE club_id = ?', [adminClubId]);
    const [[{ pending }]] = await db.query('SELECT COUNT(*) as pending FROM certificates WHERE club_id = ? AND status = "pending"', [adminClubId]);
    const [[{ approved }]] = await db.query('SELECT COUNT(*) as approved FROM certificates WHERE club_id = ? AND status = "approved"', [adminClubId]);
    const [[{ eCertificates }]] = await db.query('SELECT COUNT(*) as eCertificates FROM e_certificates WHERE club_id = ?', [adminClubId]);

    res.json({ success: true, data: { total, pending, approved, eCertificates } });
  } catch(err) { next(err); }
};

module.exports = {
  getPendingCertificates,
  approveCertificate,
  rejectCertificate,
  getAdminStats
};
