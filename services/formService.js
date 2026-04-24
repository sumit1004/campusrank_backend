const db = require('../config/db');

/**
 * Get submissions for a form with all associated data, optimized with JOINs
 */
const getSubmissions = async (formId, search) => {
  let query = `
    SELECT 
      s.id, s.created_at, 
      u.name AS student_name, u.erp AS student_erp, u.email AS student_email,
      sd.value, sd.member_index, 
      ff.field_name, ff.field_type, ff.id as field_id
    FROM submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN submission_data sd ON sd.submission_id = s.id
    LEFT JOIN form_fields ff ON ff.id = sd.field_id
    WHERE s.form_id = ?
  `;
  const params = [formId];

  if (search) {
    query += ` AND (u.name LIKE ? OR u.erp LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ` ORDER BY s.created_at DESC, sd.member_index, ff.field_order`;

  const [rows] = await db.query(query, params);

  // Group the flat rows into structured submission objects
  const submissionMap = new Map();
  
  rows.forEach(row => {
    if (!submissionMap.has(row.id)) {
      submissionMap.set(row.id, {
        id: row.id,
        created_at: row.created_at,
        student_name: row.student_name,
        student_erp: row.student_erp,
        student_email: row.student_email,
        data: []
      });
    }
    
    if (row.field_id) {
      submissionMap.get(row.id).data.push({
        value: row.value,
        member_index: row.member_index,
        field_name: row.field_name,
        field_type: row.field_type
      });
    }
  });

  return Array.from(submissionMap.values());
};

module.exports = { getSubmissions };
