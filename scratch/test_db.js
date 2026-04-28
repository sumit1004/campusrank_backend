const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
  console.log('Testing connection to:', process.env.DB_HOST);
  console.log('User:', process.env.DB_USER);
  console.log('DB Name:', process.env.DB_NAME);
  console.log('Port:', process.env.DB_PORT || 'Default (3306)');

  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 5000
    });
    console.log('✅ Connection successful!');
    await connection.end();
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    if (error.code === 'ETIMEDOUT') {
      console.error('Hint: The connection timed out. This often means the server IP is not whitelisted or the host/port is unreachable.');
    }
  }
}

testConnection();
