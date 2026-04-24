const db = require('./config/db');

async function fixCache() {
  console.log('Starting Leaderboard Cache Fix...');
  
  try {
    // 1. Truncate leaderboard_cache
    console.log('Truncating leaderboard_cache...');
    await db.query('TRUNCATE TABLE leaderboard_cache');
    
    // 2. Repopulate from event_participation
    console.log('Repopulating leaderboard_cache from event_participation...');
    
    // Get all participation records
    const [participations] = await db.query('SELECT user_id, club_id, points, event_date FROM event_participation');
    
    console.log(`Found ${participations.length} records to process.`);
    
    const query = `
      INSERT INTO leaderboard_cache 
      (user_id, club_id, total_points, month, year)
      VALUES (?, ?, ?, MONTH(?), YEAR(?))
      ON DUPLICATE KEY UPDATE
      total_points = total_points + VALUES(total_points),
      updated_at = CURRENT_TIMESTAMP
    `;
    
    for (const p of participations) {
      // 1. Update Specific Club Cache
      await db.query(query, [p.user_id, p.club_id, p.points, p.event_date, p.event_date]);

      // 2. Update University-Wide Cache (club_id = 0)
      await db.query(query, [p.user_id, 0, p.points, p.event_date, p.event_date]);
    }
    
    console.log('Leaderboard Cache Fix completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing cache:', error);
    process.exit(1);
  }
}

fixCache();
