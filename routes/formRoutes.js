const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
  createForm,
  getForms,
  getActiveForms,
  getFormById,
  updateForm,
  deleteForm,
  submitForm,
  getSubmissions,
  exportSubmissions,
  getMySubmission,
  toggleFormStatus,
} = require('../controllers/formController');

// Admin routes
router.post('/', protect, authorize('admin', 'superadmin'), createForm);
router.get('/', protect, authorize('admin', 'superadmin'), getForms);
router.put('/:id', protect, authorize('admin', 'superadmin'), updateForm);
router.delete('/:id', protect, authorize('admin', 'superadmin'), deleteForm);
router.put('/:id/status', protect, authorize('admin', 'superadmin'), toggleFormStatus);
router.get('/:id/submissions', protect, authorize('admin', 'superadmin'), getSubmissions);
router.get('/:id/export', protect, authorize('admin', 'superadmin'), exportSubmissions);

// Shared / Student routes
router.get('/active', protect, getActiveForms);
router.get('/:id', protect, getFormById);
router.post('/:id/submit', protect, authorize('student'), submitForm);
router.get('/:id/my-submission', protect, getMySubmission);

module.exports = router;
