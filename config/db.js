const mysql = require('mysql2');
require('dotenv').config();

// Create a connection pool to manage MySQL connections efficiently
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,   // Adjust maximum number of active connections if needed
  queueLimit: 0          // No limit on pending requests in the queue
});


async function initTables() {

  console.log("Creating tables...");
}

module.exports = {
  pool: pool.promise(),
  initTables
};