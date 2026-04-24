const express = require('express');
const router = express.Router();

const {
  getLeaderboard
} = require('../controllers/leaderboardController');
const { optionalProtect } = require('../middlewares/authMiddleware');

// GET /api/leaderboard?type=overall|club&club_id=1&filter=monthly|yearly
router.get('/', optionalProtect, getLeaderboard);

module.exports = router;

