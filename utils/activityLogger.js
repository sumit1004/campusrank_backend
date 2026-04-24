const db = require('../config/db');

/**
 * @desc    Log a user activity to the database
 * @param   {number} userId - ID of the user performing the action
 * @param   {string} actionType - Type of action (e.g., VERIFY_CERT)
 * @param   {number} targetId - ID of the affected resource (optional)
 * @param   {object} metadata - Additional info in JSON format (optional)
 */
const logActivity = async (userId, actionType, targetId = null, metadata = {}) => {
  try {
    const query = `
      INSERT INTO activity_logs (user_id, action_type, target_id, metadata)
      VALUES (?, ?, ?, ?)
    `;
    await db.query(query, [userId, actionType, targetId, JSON.stringify(metadata)]);
  } catch (error) {
    console.error('Activity Logging Error:', error);
    // We don't throw error here to avoid breaking the main request flow
  }
};

module.exports = { logActivity };
