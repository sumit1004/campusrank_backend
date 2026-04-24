const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { saveTemplate, getTemplates, getTemplateById, deleteTemplate } = require('../controllers/templateController');

router.post('/', protect, authorize('admin', 'superadmin'), saveTemplate);
router.get('/', protect, authorize('admin', 'superadmin'), getTemplates);
router.get('/:id', protect, authorize('admin', 'superadmin'), getTemplateById);
router.delete('/:id', protect, authorize('admin', 'superadmin'), deleteTemplate);

module.exports = router;
