const express = require('express');
const router = express.Router();
const { signup, login, updateProfile, getProfile } = require('../controllers/authController');

// POST /api/auth/signup
router.post('/signup', signup);

// POST /api/auth/login
router.post('/login', login);

const { protect } = require('../middlewares/authMiddleware');

// GET /api/auth/profile
router.get('/profile', protect, getProfile);

// PUT /api/auth/profile
router.put('/profile', protect, updateProfile);

module.exports = router;
