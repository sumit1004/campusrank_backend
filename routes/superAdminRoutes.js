const express = require('express');
const router = express.Router();
const {
  getAllUsers,
  getClubs,
  makeAdmin,
  removeAdmin,
  changeClub,
  getAnalytics,
  searchUsers,
  deleteUser,
  getAllCertificates,
  getAdminActivities,
  getFormsMonitoring,
  getBadgeAudit
} = require('../controllers/superAdminController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);
router.use(authorize('superadmin'));

router.get('/analytics', getAnalytics);
router.get('/search-users', searchUsers);
router.delete('/user/:id', deleteUser);
router.get('/certificates', getAllCertificates);
router.get('/activities', getAdminActivities);
router.get('/forms-monitoring', getFormsMonitoring);
router.get('/badges-audit', getBadgeAudit);

router.get('/users', getAllUsers);
router.get('/clubs', getClubs);
router.put('/make-admin', makeAdmin);
router.put('/remove-admin', removeAdmin);
router.put('/change-club', changeClub);

module.exports = router;
