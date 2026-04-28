const express = require('express');
const router = express.Router();
const { 
  uploadCertificate, 
  getStudentCertificates,
  bulkGenerateCertificates,
  getMyECertificates,
  getMyParticipations,
  verifyCertificate
} = require('../controllers/certificateController');

const { protect, authorize } = require('../middlewares/authMiddleware');
const { upload, avatarUpload } = require('../middlewares/uploadMiddleware');
const multer = require('multer');
const memoryUpload = multer({ storage: multer.memoryStorage() });

// POST /api/certificates/upload (Legacy/Manual)
router.post('/upload', protect, upload.single('file'), uploadCertificate);

// GET /api/certificates/my-certificates (Legacy/Manual)
router.get('/my-certificates', protect, getStudentCertificates);

// --- E-Certificate System ---

// POST /api/certificates/bulk-generate (Admin only)
router.post('/bulk-generate', protect, authorize('admin', 'superadmin'), memoryUpload.single('file'), bulkGenerateCertificates);



// GET /api/certificates/my-e-certificates (Student)
router.get('/my-e-certificates', protect, getMyECertificates);

// GET /api/certificates/my-participations (Student)
router.get('/my-participations', protect, getMyParticipations);

// GET /api/certificates/verify/:certId (Public)
router.get('/verify/:certId', verifyCertificate);

module.exports = router;

