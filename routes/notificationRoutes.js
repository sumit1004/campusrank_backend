const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, sendManualNotification } = require('../controllers/notificationController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);
router.post('/send', authorize('admin', 'superadmin'), sendManualNotification);

module.exports = router;
