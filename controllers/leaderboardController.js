const { getLeaderboardData } = require('../services/leaderboardService');

/**
 * @desc    Get leaderboard (overall or club-wise) with time filters + pagination
 * @route   GET /api/leaderboard
 * @access  Public
 */
const getLeaderboard = async (req, res, next) => {
  try {
    const { type, club_id, filter = 'overall', page = 1, limit = 50 } = req.query;
    
    const result = await getLeaderboardData(
      type, 
      club_id, 
      filter, 
      parseInt(page), 
      Math.min(parseInt(limit), 100) // Cap limit at 100
    );

    res.status(200).json({
      success: true,
      count: result.data.length,
      total: result.total,
      page: parseInt(page),
      data: result.data
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLeaderboard
};
