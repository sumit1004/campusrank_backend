const db = require('./config/db');

async function applyFKs() {
  try {
    console.log('Adding Foreign Keys to event_participation...');
    
    // Ignore error if fk already exists
    try {
      await db.query(`ALTER TABLE event_participation ADD CONSTRAINT fk_ep_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
    } catch(e) { if(e.code !== 'ER_DUP_KEYNAME') throw e; }
    
    try {
      await db.query(`ALTER TABLE event_participation ADD CONSTRAINT fk_ep_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`);
    } catch(e) { if(e.code !== 'ER_DUP_KEYNAME') throw e; }
    
    console.log('Adding Foreign Keys to leaderboard_cache...');
    try {
      await db.query(`ALTER TABLE leaderboard_cache ADD CONSTRAINT fk_lc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
    } catch(e) { if(e.code !== 'ER_DUP_KEYNAME') throw e; }
    
    try {
      await db.query(`ALTER TABLE leaderboard_cache ADD CONSTRAINT fk_lc_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`);
    } catch(e) { if(e.code !== 'ER_DUP_KEYNAME') throw e; }
    
    console.log('✅ Foreign Keys applied successfully.');
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_NO_REFERENCED_ROW_2') {
      console.warn('⚠️ Could not apply FKs due to existing orphaned data.');
    } else {
      console.error('Error:', error);
    }
  } finally {
    process.exit();
  }
}

applyFKs();
