/**
 * Utility to calculate badge based on points
 * @param {number} points 
 * @returns {string} Badge title
 */
const getBadge = (points) => {
  if (points >= 1500) return "Elite";
  if (points >= 1000) return "Level 3";
  if (points >= 800) return "Level 2";
  if (points >= 500) return "Level 1";
  return "None";
};

/**
 * Get the next badge requirement
 * @param {number} points 
 * @returns {object|null} Next badge name and points
 */
const getNextBadge = (points) => {
  if (points < 500) return { name: "Level 1", points: 500 };
  if (points < 800) return { name: "Level 2", points: 800 };
  if (points < 1000) return { name: "Level 3", points: 1000 };
  if (points < 1500) return { name: "Elite", points: 1500 };
  return null;
};

module.exports = { getBadge, getNextBadge };
