const db = require('../config/db');

/**
 * @desc    Get current user notifications
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const query = `
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 20
    `;
    const [notifications] = await db.query(query, [userId]);
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    await db.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send manual notification (Broadcast or Single)
 * @route   POST /api/notifications/send
 * @access  Private (Admin/Superadmin)
 */
const sendManualNotification = async (req, res, next) => {
  try {
    const { title, message, type = 'info', target_type, erp } = req.body;

    if (!message || !target_type) {
      res.status(400);
      throw new Error('Please provide message and target_type');
    }

    let userIds = [];

    if (target_type === 'all_students') {
      const [students] = await db.query("SELECT id FROM users WHERE role = 'student'");
      userIds = students.map(u => u.id);
    } else if (target_type === 'all_admins') {
      const [admins] = await db.query("SELECT id FROM users WHERE role = 'admin'");
      userIds = admins.map(u => u.id);
    } else if (target_type === 'single_user') {
      if (!erp) {
        res.status(400);
        throw new Error('ERP ID is required for single_user target');
      }
      const [user] = await db.query("SELECT id FROM users WHERE erp = ?", [erp]);
      if (user.length === 0) {
        res.status(404);
        throw new Error('User with this ERP not found');
      }
      userIds = [user[0].id];
    } else if (target_type === 'all') {
      const [all] = await db.query("SELECT id FROM users");
      userIds = all.map(u => u.id);
    }

    // Bulk insert notifications
    if (userIds.length > 0) {
      const values = userIds.map(id => [id, title || 'System Alert', message, type]);
      await db.query(
        'INSERT INTO notifications (user_id, title, message, type) VALUES ?',
        [values]
      );
    }

    res.status(200).json({ 
      success: true, 
      message: `Notification transmitted to ${userIds.length} recipients` 
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNotifications, markAsRead, sendManualNotification };
