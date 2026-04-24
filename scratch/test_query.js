const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  
  const user = { id: 7, role: 'admin', club_id: 18 };
  
  let query = `SELECT f.*, u.name AS admin_name,
        (SELECT COUNT(*) FROM submissions s WHERE s.form_id = f.id) AS submission_count
       FROM forms f
       LEFT JOIN users u ON u.id = f.club_id`;
  let params = [];

  if (user.role !== 'superadmin') {
    query += ` WHERE f.club_id = ?`;
    params.push(user.club_id);
  }

  query += ` ORDER BY f.created_at DESC`;
  
  console.log('Query:', query);
  console.log('Params:', params);
  
  const [forms] = await db.query(query, params);
  console.log('Results:', forms);
  
  await db.end();
})();
