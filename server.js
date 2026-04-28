require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const db = require('./config/db');
const { errorHandler } = require('./middlewares/errorMiddleware');
const { protect } = require('./middlewares/authMiddleware');

const app = express();
app.set('trust proxy', 1);

// --- Security ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// --- CORS ---
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://campus-rank.netlify.app"
  ],
  credentials: true
}));

// --- Body ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --- Static ---
const UPLOADS_PATH = path.join(__dirname, 'uploads');
const ASSETS_PATH = path.join(__dirname, 'assets');

app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/assets', express.static(ASSETS_PATH));

console.log(`📂 Serving uploads from: ${UPLOADS_PATH}`);

// --- Rate Limit ---
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30 });

// --- Routes ---
app.use('/api/auth', authLimiter, require('./routes/authRoutes'));
app.use('/api/certificates', uploadLimiter, require('./routes/certificateRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/clubs', require('./routes/clubsRoutes'));
app.use('/api/superadmin', require('./routes/superAdminRoutes'));
app.use('/api/leaderboard', require('./routes/leaderboardRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/forms', require('./routes/formRoutes'));
app.use('/api/templates', require('./routes/templateRoutes'));
app.use('/api/users', require('./routes/userRoutes'));

// --- Profile ---
const { getUserProfile, updateProfile } = require('./controllers/userController');
app.get('/api/profile', protect, getUserProfile);
app.put('/api/profile', protect, updateProfile);

// --- Root ---
app.get('/', (req, res) => {
  res.send('CampusRank API is running 🚀');
});

// --- Error ---
app.use(errorHandler);

// --- DB TEST (IMPORTANT)
(async () => {
  try {
    const [rows] = await db.execute("SELECT 1");
    console.log("✅ DB Connected Successfully");
  } catch (err) {
    console.error("❌ DB Connection Failed:", err.message);
  }
})();

// --- Server ---
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const { autoCloseExpired } = require('./controllers/formController');

  const runJob = async () => {
    try {
      await autoCloseExpired();
    } catch (err) {
      console.error('AutoClose Job Error:', err.message);
    }
  };

  setInterval(runJob, 60 * 60 * 1000);
  runJob();
});