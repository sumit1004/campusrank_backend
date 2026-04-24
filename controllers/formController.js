const db = require('../config/db');
const ExcelJS = require('exceljs');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notificationHelper');

// ─── Helper: auto-close forms past end_date ────────────────────────────────
const autoCloseExpired = async () => {
  try {
    await db.query(
      `UPDATE forms SET status = 'closed' WHERE end_date IS NOT NULL AND end_date < NOW() AND status = 'active'`
    );
  } catch (_) {}
};

// ─── INIT TABLES ──────────────────────────────────────────────────────────
const initTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS forms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      club_id INT,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      event_date DATE,
      venue VARCHAR(255),
      type ENUM('solo','team') DEFAULT 'solo',
      team_size INT DEFAULT 1,
      start_date DATETIME,
      end_date DATETIME,
      status ENUM('active','closed') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS form_fields (
      id INT AUTO_INCREMENT PRIMARY KEY,
      form_id INT NOT NULL,
      field_name VARCHAR(255) NOT NULL,
      field_type ENUM('text','number','email','select','file') DEFAULT 'text',
      options TEXT,
      required BOOLEAN DEFAULT FALSE,
      apply_to ENUM('leader','all') DEFAULT 'all',
      field_order INT DEFAULT 0,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      form_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS submission_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      submission_id INT NOT NULL,
      field_id INT NOT NULL,
      value TEXT,
      member_index INT DEFAULT 1,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (field_id) REFERENCES form_fields(id) ON DELETE CASCADE
    )
  `);

  // Migration: Ensure is_default column exists in form_fields
  try {
    await db.query(`ALTER TABLE form_fields ADD COLUMN is_default BOOLEAN DEFAULT FALSE`);
  } catch (err) {
    // Column likely already exists
  }

  // Migration: Enforce unique registration at DB level (idempotent)
  try {
    await db.query(`
      ALTER TABLE submissions
      ADD UNIQUE KEY unique_registration (form_id, user_id)
    `);
  } catch (err) {
    // Key already exists — safe to ignore
  }
};

// Run init immediately
initTables().catch(console.error);

// ─── Compute form status label ─────────────────────────────────────────────
const getStatusLabel = (form) => {
  const now = new Date();
  const start = form.start_date ? new Date(form.start_date) : null;
  const end = form.end_date ? new Date(form.end_date) : null;
  
  // If explicitly closed by admin, it's closed
  if (form.status === 'closed') return 'Closed';
  
  // If we haven't reached start date, it's coming soon
  if (start && now < start) return 'Coming Soon';
  
  // If we've passed the end date, it's closed, 
  // but let's be careful about timezone drifts (30s buffer)
  if (end && now.getTime() > (end.getTime() + 30000)) return 'Closed';
  
  return 'Open';
};

// ─── CREATE FORM ──────────────────────────────────────────────────────────
const createForm = async (req, res) => {
  const { title, description, event_date, venue, type, team_size, start_date, end_date, fields } = req.body;
  const club_id = req.user.club_id;

  try {
    const [result] = await db.query(
      `INSERT INTO forms (club_id, title, description, event_date, venue, type, team_size, start_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [club_id, title, description, event_date || null, venue, type || 'solo', team_size || 1, start_date || null, end_date || null]
    );
    const formId = result.insertId;

    // --- HANDLE DEFAULT FIELDS ---
    const defaultFieldsMap = {
      'Name': { type: 'text', req: true, apply: 'all', order: 1 },
      'ERP': { type: 'text', req: true, apply: 'all', order: 2 },
      'Email': { type: 'email', req: true, apply: 'all', order: 3 },
      'Mobile Number': { type: 'number', req: true, apply: 'all', order: 4 },
      'Section': { type: 'text', req: true, apply: 'all', order: 5 },
      'Semester': { type: 'number', req: true, apply: 'all', order: 6 },
      'College': { type: 'text', req: true, apply: 'all', order: 7 },
    };

    // If admin provided overrides for default fields in the request
    if (fields && fields.length > 0) {
      fields.forEach(f => {
        if (defaultFieldsMap[f.field_name]) {
          defaultFieldsMap[f.field_name] = {
            type: f.field_type || defaultFieldsMap[f.field_name].type,
            req: f.required !== undefined ? !!f.required : defaultFieldsMap[f.field_name].req,
            apply: f.apply_to || defaultFieldsMap[f.field_name].apply,
            order: defaultFieldsMap[f.field_name].order,
            options: f.options || null
          };
        }
      });
    }

    // Insert Default Fields (either original or overridden)
    for (const [name, config] of Object.entries(defaultFieldsMap)) {
      await db.query(
        `INSERT INTO form_fields (form_id, field_name, field_type, options, required, apply_to, field_order, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [formId, name, config.type, config.options || null, config.req ? 1 : 0, config.apply, config.order, 1]
      );
    }

    // Insert Custom Fields
    if (fields && fields.length > 0) {
      const customFields = fields.filter(f => !defaultFieldsMap[f.field_name]);
      for (let i = 0; i < customFields.length; i++) {
        const f = customFields[i];
        await db.query(
          `INSERT INTO form_fields (form_id, field_name, field_type, options, required, apply_to, field_order, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [formId, f.field_name, f.field_type || 'text', f.options || null, f.required ? 1 : 0, f.apply_to || 'all', i + 8, 0]
        );
      }
    }

    // LOG ACTION
    logActivity(req.user.id, 'CREATE_FORM', formId, { title });

    res.status(201).json({ success: true, message: 'Form created successfully', data: { id: formId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

// ─── GET ALL FORMS (ADMIN) ─────────────────────────────────────────────────
const getForms = async (req, res) => {
  try {
    let query = `SELECT f.*, 
        (SELECT COUNT(*) FROM submissions s WHERE s.form_id = f.id) AS submission_count
       FROM forms f`;
    let params = [];

    if (req.user.role !== 'superadmin') {
      query += ` WHERE f.club_id = ?`;
      params.push(req.user.club_id);
    }

    query += ` ORDER BY f.created_at DESC`;
    const [forms] = await db.query(query, params);
    const enriched = forms.map(f => ({ ...f, status_label: getStatusLabel(f) }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── GET ACTIVE FORMS (STUDENT) ────────────────────────────────────────────
const getActiveForms = async (req, res) => {
  try {
    const [forms] = await db.query(
      `SELECT f.*, u.name AS admin_name
       FROM forms f
       LEFT JOIN users u ON u.id = f.club_id
       ORDER BY f.created_at DESC`
    );
    const enriched = forms.map(f => ({ ...f, status_label: getStatusLabel(f) }));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── GET SINGLE FORM ──────────────────────────────────────────────────────
const getFormById = async (req, res) => {
  try {
    const [forms] = await db.query(
      `SELECT f.*, u.name AS admin_name FROM forms f LEFT JOIN users u ON u.id = f.club_id WHERE f.id = ?`,
      [req.params.id]
    );
    if (!forms.length) return res.status(404).json({ success: false, message: 'Form not found' });

    const [fields] = await db.query(
      `SELECT * FROM form_fields WHERE form_id = ? ORDER BY field_order ASC`,
      [req.params.id]
    );

    const form = { ...forms[0], status_label: getStatusLabel(forms[0]), fields };
    res.json({ success: true, data: form });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── UPDATE FORM ──────────────────────────────────────────────────────────
const updateForm = async (req, res) => {
  const { title, description, event_date, venue, type, team_size, start_date, end_date, fields } = req.body;
  const { id } = req.params;

  try {
    const now = new Date();
    const end = end_date ? new Date(end_date) : null;
    let newStatus = 'active';
    if (end && now > end) newStatus = 'closed';

    let query = `UPDATE forms SET title=?, description=?, event_date=?, venue=?, type=?, team_size=?, start_date=?, end_date=?, status=? WHERE id=?`;
    let params = [title, description, event_date || null, venue, type, team_size || 1, start_date || null, end_date || null, newStatus, id];

    if (req.user.role !== 'superadmin') {
      query += ` AND club_id=?`;
      params.push(req.user.club_id);
    }

    await db.query(query, params);

    if (fields) {
      // Update ALL fields by deleting and re-inserting based on what admin provided
      await db.query(`DELETE FROM form_fields WHERE form_id = ?`, [id]);
      
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await db.query(
          `INSERT INTO form_fields (form_id, field_name, field_type, options, required, apply_to, field_order, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, f.field_name, f.field_type || 'text', f.options || null, f.required ? 1 : 0, f.apply_to || 'all', i + 1, f.is_default ? 1 : 0]
        );
      }
    }

    res.json({ success: true, message: 'Form updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── DELETE FORM ──────────────────────────────────────────────────────────
const deleteForm = async (req, res) => {
  try {
    let query = `DELETE FROM forms WHERE id=?`;
    let params = [req.params.id];

    if (req.user.role !== 'superadmin') {
      query += ` AND club_id=?`;
      params.push(req.user.club_id);
    }

    await db.query(query, params);
    res.json({ success: true, message: 'Form deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── TOGGLE FORM STATUS ────────────────────────────────────────────────────
const toggleFormStatus = async (req, res) => {
  const { status, end_date } = req.body; // 'active' or 'closed'
  const { id } = req.params;
  try {
    let query = `UPDATE forms SET status=? WHERE id=?`;
    let params = [status, id];

    if (status === 'active' && end_date) {
      query = `UPDATE forms SET status=?, end_date=? WHERE id=?`;
      params = ['active', end_date, id];
    }

    if (req.user.role !== 'superadmin') {
      query += ` AND club_id=?`;
      params.push(req.user.club_id);
    }

    await db.query(query, params);
    res.json({ success: true, message: `Form ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── SUBMIT FORM ──────────────────────────────────────────────────────────
const submitForm = async (req, res) => {
  const { id: formId } = req.params;
  const userId = req.user.id;
  const { members } = req.body; // array of { field_id, value, member_index }

  try {
    // Check form exists and is open
    const [forms] = await db.query(`SELECT * FROM forms WHERE id = ?`, [formId]);
    if (!forms.length) return res.status(404).json({ success: false, message: 'Form not found' });

    const form = forms[0];
    const statusLabel = getStatusLabel(form);
    if (statusLabel !== 'Open') {
      return res.status(400).json({ success: false, message: `Form is ${statusLabel}. Registration not allowed.` });
    }

    // Check already submitted
    const [existing] = await db.query(
      `SELECT id FROM submissions WHERE form_id=? AND user_id=?`,
      [formId, userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'You have already registered for this event.' });
    }

    // ── SUBMISSION VALIDATION ─────────────────────────────────────────────
    // 1. Fetch all fields that belong to this form
    const [formFields] = await db.query(
      `SELECT id, field_name, required, apply_to FROM form_fields WHERE form_id = ?`,
      [formId]
    );

    // Build lookup maps for fast access
    const validFieldIds = new Set(formFields.map(f => f.id));
    const requiredFields = formFields.filter(f => f.required);

    // 2. Validate that every submitted field_id actually belongs to this form
    if (members && members.length > 0) {
      for (const entry of members) {
        if (!validFieldIds.has(Number(entry.field_id))) {
          return res.status(400).json({
            success: false,
            message: `Invalid field_id ${entry.field_id}: does not belong to this form.`
          });
        }
      }
    }

    // 3. Determine how many members are in this submission
    const memberIndices = members && members.length > 0
      ? [...new Set(members.map(e => e.member_index || 1))]
      : [1];

    // 4. Check that every required field has a value for each member
    //    (fields with apply_to='leader' are only required for member_index 1)
    for (const field of requiredFields) {
      const indices = field.apply_to === 'leader' ? [1] : memberIndices;
      for (const idx of indices) {
        const supplied = members && members.find(
          e => Number(e.field_id) === field.id && (e.member_index || 1) === idx
        );
        if (!supplied || supplied.value === null || supplied.value === undefined || String(supplied.value).trim() === '') {
          return res.status(400).json({
            success: false,
            message: `Required field "${field.field_name}" is missing or empty for member ${idx}.`
          });
        }
      }
    }
    // ── END VALIDATION ────────────────────────────────────────────────────

    // Create submission
    const [subResult] = await db.query(
      `INSERT INTO submissions (form_id, user_id) VALUES (?, ?)`,
      [formId, userId]
    );
    const submissionId = subResult.insertId;

    // Insert submission_data
    if (members && members.length > 0) {
      for (const entry of members) {
        await db.query(
          `INSERT INTO submission_data (submission_id, field_id, value, member_index) VALUES (?, ?, ?, ?)`,
          [submissionId, entry.field_id, entry.value || '', entry.member_index || 1]
        );
      }
    }

    // NOTIFY STUDENT 
    createNotification(userId, `You successfully registered for ${form.title}! ✅`, 'success', 'Registration Confirmed');
    
    // LOG ACTION (Optional but good)
    logActivity(userId, 'SUBMIT_FORM', submissionId, { form_id: formId });

    res.status(201).json({ success: true, message: 'Registered successfully!' });
  } catch (err) {
    // DB-level duplicate catch (ER_DUP_ENTRY = 1062) — belt-and-suspenders
    // guard if the app-level check above was somehow bypassed (race condition).
    if (err.errno === 1062 || err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Already registered for this form.' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

const { getSubmissions: fetchSubmissions } = require('../services/formService');

// ─── GET SUBMISSIONS (ADMIN) ───────────────────────────────────────────────
const getSubmissions = async (req, res) => {
  const { search } = req.query;
  try {
    const submissions = await fetchSubmissions(req.params.id, search);
    res.json({ success: true, data: submissions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── EXPORT EXCEL ─────────────────────────────────────────────────────────
const exportSubmissions = async (req, res) => {
  try {
    const [forms] = await db.query(`SELECT * FROM forms WHERE id=?`, [req.params.id]);
    if (!forms.length) return res.status(404).json({ success: false, message: 'Form not found' });
    const form = forms[0];

    const [fields] = await db.query(
      `SELECT * FROM form_fields WHERE form_id=? ORDER BY field_order ASC`,
      [req.params.id]
    );

    const [submissions] = await db.query(
      `SELECT s.id, s.created_at, u.name AS student_name, u.erp AS student_erp, u.email AS student_email
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.form_id = ?
       ORDER BY s.created_at ASC`,
      [req.params.id]
    );

    for (const sub of submissions) {
      const [data] = await db.query(
        `SELECT sd.field_id, sd.value, sd.member_index FROM submission_data sd WHERE sd.submission_id = ?`,
        [sub.id]
      );
      sub.data = data;
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CampusRank';
    const worksheet = workbook.addWorksheet('Registrations');

    // Determine max team size
    const maxMembers = form.type === 'team' ? (form.team_size || 1) : 1;

    // Build columns
    const columns = [
      { header: '#', key: 'no', width: 6 },
      { header: 'Name', key: 'student_name', width: 22 },
      { header: 'ERP', key: 'student_erp', width: 14 },
      { header: 'Email', key: 'student_email', width: 28 },
    ];

    for (let m = 1; m <= maxMembers; m++) {
      const prefix = maxMembers > 1 ? (m === 1 ? 'Leader - ' : `Member ${m} - `) : '';
      for (const f of fields) {
        if (f.apply_to === 'leader' && m > 1) continue;
        columns.push({ header: `${prefix}${f.field_name}`, key: `f_${f.id}_m_${m}`, width: 22 });
      }
    }

    columns.push({ header: 'Registered At', key: 'created_at', width: 22 });
    worksheet.columns = columns;

    // Style header
    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Add rows
    submissions.forEach((sub, idx) => {
      const row = {
        no: idx + 1,
        student_name: sub.student_name,
        student_erp: sub.student_erp,
        student_email: sub.student_email,
        created_at: new Date(sub.created_at).toLocaleString(),
      };

      for (let m = 1; m <= maxMembers; m++) {
        for (const f of fields) {
          if (f.apply_to === 'leader' && m > 1) continue;
          const entry = sub.data.find(d => d.field_id === f.id && d.member_index === m);
          row[`f_${f.id}_m_${m}`] = entry ? entry.value : '';
        }
      }

      const addedRow = worksheet.addRow(row);
      if (idx % 2 === 0) {
        addedRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F8FF' } };
        });
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${form.title.replace(/\s+/g, '_')}_registrations.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Export failed', error: err.message });
  }
};

// ─── GET MY SUBMISSION (STUDENT) ───────────────────────────────────────────
const getMySubmission = async (req, res) => {
  try {
    const [submissions] = await db.query(
      `SELECT s.id, s.created_at FROM submissions s WHERE s.form_id=? AND s.user_id=?`,
      [req.params.id, req.user.id]
    );
    if (!submissions.length) return res.json({ success: true, data: null });

    const sub = submissions[0];
    const [data] = await db.query(
      `SELECT sd.value, sd.member_index, ff.field_name FROM submission_data sd
       JOIN form_fields ff ON ff.id = sd.field_id
       WHERE sd.submission_id = ?
       ORDER BY sd.member_index, ff.field_order`,
      [sub.id]
    );
    sub.data = data;

    res.json({ success: true, data: sub });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  createForm, getForms, getActiveForms, getFormById,
  updateForm, deleteForm, toggleFormStatus,
  submitForm, getSubmissions, exportSubmissions, getMySubmission,
  autoCloseExpired
};
