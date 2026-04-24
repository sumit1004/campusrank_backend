const express = require('express');
const router = express.Router();
const { getUserProfile, updateProfile, uploadAvatar } = require('../controllers/userController');
const { protect } = require('../middlewares/authMiddleware');
const { avatarUpload } = require('../middlewares/uploadMiddleware');

router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateProfile);
router.post('/avatar', protect, avatarUpload.single('avatar'), uploadAvatar);

module.exports = router;
