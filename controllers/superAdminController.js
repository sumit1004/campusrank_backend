const db = require('../config/db');

/**
 * @desc    Get all users
 * @route   GET /api/superadmin/users
 */
const getAllUsers = async (req, res, next) => {
  try {
    const [users] = await db.query('SELECT id, name, email, role, club_id, COALESCE(total_points, 0) as total_points FROM users ORDER BY created_at DESC');
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all clubs for dropdowns
 * @route   GET /api/superadmin/clubs
 */
const getClubs = async (req, res, next) => {
  try {
    const [clubs] = await db.query('SELECT id, name FROM clubs ORDER BY name ASC');
    res.status(200).json({ success: true, count: clubs.length, data: clubs });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Assign admin role to a previously student user
 * @route   PUT /api/superadmin/make-admin
 */
const makeAdmin = async (req, res, next) => {
  try {
    const { user_id, club_id } = req.body;
    if (!user_id || !club_id) {
      res.status(400); throw new Error('Please provide user_id and club_id');
    }

    const [users] = await db.query('SELECT id FROM users WHERE id = ?', [user_id]);
    if (users.length === 0) { res.status(404); throw new Error('User not found'); }

    // Ensure club exists
    const [clubs] = await db.query('SELECT id FROM clubs WHERE id = ?', [club_id]);
    if (clubs.length === 0) { res.status(404); throw new Error('Club not found'); }

    await db.query(`UPDATE users SET role = 'admin', club_id = ? WHERE id = ?`, [club_id, user_id]);

    res.status(200).json({ success: true, message: 'User is now an admin of the club' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Convert an admin back to a student role
 * @route   PUT /api/superadmin/remove-admin
 */
const removeAdmin = async (req, res, next) => {
  try {
    const { user_id } = req.body;
    if (!user_id) { res.status(400); throw new Error('Please provide user_id'); }

    const [users] = await db.query('SELECT id FROM users WHERE id = ?', [user_id]);
    if (users.length === 0) { res.status(404); throw new Error('User not found'); }

    await db.query(`UPDATE users SET role = 'student', club_id = NULL WHERE id = ?`, [user_id]);

    res.status(200).json({ success: true, message: 'Admin role removed.' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change the club assigned to an existing admin
 * @route   PUT /api/superadmin/change-club
 */
const changeClub = async (req, res, next) => {
  try {
    const { user_id, club_id } = req.body;
    if (!user_id || !club_id) { res.status(400); throw new Error('Please provide user_id and club_id'); }

    const [users] = await db.query('SELECT id, role FROM users WHERE id = ?', [user_id]);
    if (users.length === 0) { res.status(404); throw new Error('User not found'); }
    if (users[0].role !== 'admin') { res.status(400); throw new Error('User is not an admin. Use make-admin instead.'); }

    const [clubs] = await db.query('SELECT id FROM clubs WHERE id = ?', [club_id]);
    if (clubs.length === 0) { res.status(404); throw new Error('Club not found'); }

    await db.query(`UPDATE users SET club_id = ? WHERE id = ?`, [club_id, user_id]);

    res.status(200).json({ success: true, message: 'Admin club changed successfully' });
  } catch (error) {
    next(error);
  }
};

const getAnalytics = async (req, res, next) => {
  try {
    const [[{ totalUsers }]] = await db.query('SELECT COUNT(*) as totalUsers FROM users');
    const [[{ totalCerts }]] = await db.query('SELECT COUNT(*) as totalCerts FROM certificates');
    const [[{ approvedCerts }]] = await db.query('SELECT COUNT(*) as approvedCerts FROM certificates WHERE status = "approved"');
    const [[{ pendingCerts }]] = await db.query('SELECT COUNT(*) as pendingCerts FROM certificates WHERE status = "pending"');
    const [[{ totalECerts }]] = await db.query('SELECT COUNT(*) as totalECerts FROM e_certificates');

    const [clubStats] = await db.query(`
      SELECT cl.name, 
        COUNT(DISTINCT c.id) as total_manual,
        SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END) as pending_manual,
        (SELECT COUNT(*) FROM e_certificates ec WHERE ec.club_id = cl.id) as total_e_certs
      FROM clubs cl
      LEFT JOIN certificates c ON cl.id = c.club_id
      GROUP BY cl.id
    `);

    res.json({ success: true, data: { totalUsers, totalCerts, approvedCerts, pendingCerts, totalECerts, clubStats } });
  } catch(err) { next(err); }
};

const searchUsers = async (req, res, next) => {
  try {
    const { query } = req.query;
    const q = `%${query}%`;
    const [users] = await db.query(`
      SELECT u.id, u.name, u.email, u.erp, u.role, COALESCE(u.total_points, 0) as total_points, c.name as club_name,
      (SELECT COUNT(*) FROM certificates certs WHERE certs.user_id = u.id) as total_certs
      FROM users u
      LEFT JOIN clubs c ON u.club_id = c.id
      WHERE u.erp LIKE ? OR u.email LIKE ? OR u.name LIKE ?
    `, [q, q, q]);

    res.json({ success: true, data: users });
  } catch(err) { next(err); }
};

const deleteUser = async (req, res, next) => {
  try {
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) { next(err); }
};

const getAllCertificates = async (req, res, next) => {
  try {
    const { club, status, search } = req.query;
    let baseQuery = `
      SELECT c.*, u.name as user_name, u.erp as user_erp, cl.name as club_name
      FROM certificates c
      JOIN users u ON c.user_id = u.id
      JOIN clubs cl ON c.club_id = cl.id
      WHERE 1=1
    `;
    const params = [];
    if (club) { baseQuery += ' AND cl.name = ?'; params.push(club); }
    if (status) { baseQuery += ' AND c.status = ?'; params.push(status); }
    if (search) { baseQuery += ' AND u.erp LIKE ?'; params.push(`%${search}%`); }
    
    baseQuery += ' ORDER BY c.created_at DESC';
    const [certs] = await db.query(baseQuery, params);
    res.json({ success: true, data: certs });
  } catch(err) { next(err); }
};

const getAdminActivities = async (req, res, next) => {
  try {
    const [activities] = await db.query(`
      SELECT al.*, u.name as admin_name, u.role as admin_role, cl.name as club_name 
      FROM activity_logs al
      JOIN users u ON al.user_id = u.id
      LEFT JOIN clubs cl ON u.club_id = cl.id
      WHERE u.role IN ('admin', 'superadmin')
      ORDER BY al.created_at DESC
      LIMIT 100
    `);
    res.json({ success: true, data: activities });
  } catch (err) { next(err); }
};

const getFormsMonitoring = async (req, res, next) => {
  try {
    const [forms] = await db.query(`
      SELECT f.id, f.title, f.event_date, f.start_date, f.end_date, f.status, cl.name as club_name, 
        (SELECT COUNT(*) FROM submissions s WHERE s.form_id = f.id) as submission_count
      FROM forms f
      LEFT JOIN clubs cl ON f.club_id = cl.id
      ORDER BY f.created_at DESC
    `);
    res.json({ success: true, data: forms });
  } catch (err) { next(err); }
};

const getBadgeAudit = async (req, res, next) => {
  try {
    // Badges are defined by point thresholds in this system
    const [users] = await db.query(`
      SELECT id, name, erp, total_points, 
        CASE 
          WHEN total_points >= 1000 THEN 'Elite'
          WHEN total_points >= 500 THEN 'Achiever'
          WHEN total_points >= 100 THEN 'Starter'
          ELSE 'Beginner'
        END as badge_tier
      FROM users 
      WHERE total_points >= 100 AND role = 'student'
      ORDER BY total_points DESC
    `);
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
};

module.exports = {
  getAllUsers,
  getClubs,
  makeAdmin,
  removeAdmin,
  changeClub,
  getAnalytics,
  searchUsers,
  deleteUser,
  getAllCertificates,
  getAdminActivities,
  getFormsMonitoring,
  getBadgeAudit
};
