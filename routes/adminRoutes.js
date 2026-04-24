const express = require('express');
const router = express.Router();

const {
  getPendingCertificates,
  approveCertificate,
  rejectCertificate
} = require('../controllers/adminController');

// Import middlewares
const { protect, authorize } = require('../middlewares/authMiddleware');

// Apply protection and authorization to all routes globally in this file
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// GET /api/admin/certificates
router.get('/certificates', getPendingCertificates);

// PUT /api/admin/approve/:id
router.put('/approve/:id', approveCertificate);

// PUT /api/admin/reject/:id
router.put('/reject/:id', rejectCertificate);

// GET /api/admin/stats
router.get('/stats', require('../controllers/adminController').getAdminStats);

module.exports = router;
