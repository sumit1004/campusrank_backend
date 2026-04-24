require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const db = require('./config/db');
const { errorHandler } = require('./middlewares/errorMiddleware');
const { protect, authorize } = require('./middlewares/authMiddleware');

const app = express();

// --- Security Headers ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' } // Allow serving uploads cross-origin
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

// --- Static File Serving ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// --- Global Rate Limiting (all API routes) ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased for rich dashboard/multi-tab use
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

// --- Strict Rate Limiting for Auth Routes ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Increased for smoother dev/testing
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes.' }
});

// --- Strict Rate Limiting for File Upload Routes ---
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: { success: false, message: 'Upload limit exceeded, please try again later.' }
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

// Backward-compatible profile routes (also handled in userRoutes)
const { getUserProfile, updateProfile } = require('./controllers/userController');
app.get('/api/profile', protect, getUserProfile);
app.put('/api/profile', protect, updateProfile);

// --- Error Handling Middleware (must be last) ---
app.use(errorHandler);

// --- Server Startup ---
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

  // Run every hour
  setInterval(runJob, 60 * 60 * 1000);

  // Run once at startup
  runJob();
});
app.get('/', (req, res) => {
  res.send('CampusRank API is running 🚀');
});