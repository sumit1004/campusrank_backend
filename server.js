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
// --- Security Headers ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// --- CORS ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// --- Body Parsers ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --- Static Files ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// --- Rate Limiting ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000
});
app.use('/api', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30
});

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

// Profile routes
const { getUserProfile, updateProfile } = require('./controllers/userController');
app.get('/api/profile', protect, getUserProfile);
app.put('/api/profile', protect, updateProfile);

// --- Root Route ---
app.get('/', (req, res) => {
  res.send('CampusRank API is running 🚀');
});

// --- Error Handler ---
app.use(errorHandler);

// --- Server Start ---
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`[CampusRank] Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);

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