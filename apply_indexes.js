require('dotenv').config();
const db = require('./config/db');

async function applyDbChanges() {
  console.log('🚀 Starting Database Hardening...');
  try {
    const queries = [
      // Format: [IndexName, TableName, ColumnList]
      ['idx_ep_user_points', 'event_participation', '(user_id, points)'],
      ['idx_ep_date_points', 'event_participation', '(event_date, points)'],
      ['idx_ep_club_date', 'event_participation', '(club_id, event_date)'],
      ['idx_users_erp_name', 'users', '(erp, name)'],
      ['idx_certs_status_club', 'certificates', '(status, club_id)'],
      ['idx_logs_created', 'activity_logs', '(created_at)']
    ];

    for (const [name, table, columns] of queries) {
      try {
        // Standard syntax without IF NOT EXISTS for better compatibility
        await db.query(`CREATE INDEX ${name} ON ${table}${columns}`);
        console.log(`✅ Success: Added index ${name}`);
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME') {
          console.log(`ℹ️ Index ${name} already exists, skipping.`);
        } else {
          console.error(`❌ Error creating index ${name}: ${err.message}`);
        }
      }
    }

    console.log('✨ Database Hardening Complete!');
  } catch (error) {
    console.error('💥 Hardening Failed:', error);
  } finally {
    process.exit();
  }
}

applyDbChanges();
