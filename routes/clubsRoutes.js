const express = require('express');
const router = express.Router();
const { getClubs, createClub, deleteClub } = require('../controllers/clubsController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.get('/', getClubs);
router.post('/', protect, authorize('superadmin'), createClub);
router.delete('/:id', protect, authorize('superadmin'), deleteClub);

module.exports = router;
