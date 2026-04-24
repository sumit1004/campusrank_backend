const db = require('../config/db');

// ─── INIT TEMPLATE TABLES ─────────────────────────────────────────────────
const initTemplateTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS form_templates (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      description TEXT,
      type        ENUM('solo','team') DEFAULT 'solo',
      team_size   INT DEFAULT 1,
      created_by  INT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS template_fields (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      field_name  VARCHAR(255) NOT NULL,
      field_type  ENUM('text','number','email','select','file') DEFAULT 'text',
      options     TEXT,
      required    BOOLEAN DEFAULT FALSE,
      apply_to    ENUM('leader','all') DEFAULT 'all',
      field_order INT DEFAULT 0,
      is_default  BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (template_id) REFERENCES form_templates(id) ON DELETE CASCADE
    )
  `);

  // Migration: Ensure is_default column exists in template_fields
  try {
    await db.query(`ALTER TABLE template_fields ADD COLUMN is_default BOOLEAN DEFAULT FALSE`);
  } catch (err) {
    // Column likely already exists
  }
};

initTemplateTables().catch(console.error);

// ─── SAVE TEMPLATE ────────────────────────────────────────────────────────
// POST /api/templates
const saveTemplate = async (req, res) => {
  const { name, description, type, team_size, fields } = req.body;
  const created_by = req.user.id;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Template name is required' });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO form_templates (name, description, type, team_size, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), description || '', type || 'solo', team_size || 1, created_by]
    );
    const templateId = result.insertId;

    if (fields && fields.length > 0) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await db.query(
          `INSERT INTO template_fields (template_id, field_name, field_type, options, required, apply_to, field_order, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            templateId,
            f.field_name,
            f.field_type || 'text',
            f.options || null,
            f.required ? 1 : 0,
            f.apply_to || 'all',
            i,
            f.is_default ? 1 : 0,
          ]
        );
      }
    }

    res.status(201).json({ success: true, message: 'Template saved!', data: { id: templateId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// ─── GET ALL TEMPLATES ────────────────────────────────────────────────────
// GET /api/templates
const getTemplates = async (req, res) => {
  try {
    const [templates] = await db.query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM template_fields tf WHERE tf.template_id = t.id) AS field_count
       FROM form_templates t
       WHERE t.created_by = ?
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── GET TEMPLATE BY ID (with fields) ────────────────────────────────────
// GET /api/templates/:id
const getTemplateById = async (req, res) => {
  try {
    const [templates] = await db.query(
      `SELECT * FROM form_templates WHERE id = ? AND created_by = ?`,
      [req.params.id, req.user.id]
    );
    if (!templates.length) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const [fields] = await db.query(
      `SELECT * FROM template_fields WHERE template_id = ? ORDER BY field_order ASC`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...templates[0], fields } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── DELETE TEMPLATE ──────────────────────────────────────────────────────
// DELETE /api/templates/:id
const deleteTemplate = async (req, res) => {
  try {
    await db.query(
      `DELETE FROM form_templates WHERE id = ? AND created_by = ?`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { saveTemplate, getTemplates, getTemplateById, deleteTemplate };
