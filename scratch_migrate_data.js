const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrateData() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('Migrating legacy data...');

    // 1. Migrate from e_certificates
    await conn.query(`
      INSERT IGNORE INTO event_participation 
      (user_id, club_id, event_name, event_date, position, source, points, created_at)
      SELECT user_id, club_id, event_name, event_date, position, 'e_certificate', points, created_at
      FROM e_certificates
    `);

    // 2. Migrate from approved manual certificates
    await conn.query(`
      INSERT IGNORE INTO event_participation 
      (user_id, club_id, event_name, event_date, position, source, points, created_at)
      SELECT user_id, club_id, IFNULL(event_name, 'Legacy Event'), event_date, position, 'manual', points, created_at
      FROM certificates
      WHERE status = 'approved'
    `);

    // 3. Sync users.total_points
    console.log('Syncing users total_points...');
    const [uResult] = await conn.query(`
      UPDATE users u
      SET total_points = IFNULL((
        SELECT SUM(points) 
        FROM event_participation 
        WHERE user_id = u.id
      ), 0)
    `);
    console.log('Synced total_points for users:', uResult.affectedRows);

    await conn.end();
    console.log('Data migration and sync complete.');
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

migrateData();
