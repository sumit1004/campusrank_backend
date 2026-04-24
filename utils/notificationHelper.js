const db = require('../config/db');

/**
 * @desc    Create a notification for a user
 * @param   {number} userId - ID of the user to notify
 * @param   {string} message - Notification message
 * @param   {string} type - 'info', 'success', or 'warning'
 * @param   {string} title - Optional title
 */
const createNotification = async (userId, message, type = 'info', title = null) => {
  try {
    const query = `
      INSERT INTO notifications (user_id, message, type, title)
      VALUES (?, ?, ?, ?)
    `;
    await db.query(query, [userId, message, type, title]);
  } catch (error) {
    console.error('Notification Creation Error:', error);
  }
};

module.exports = { createNotification };
