const db = require('../config/db');
const { logActivity } = require('../utils/activityLogger');
const { createNotification } = require('../utils/notificationHelper');
const { updateLeaderboardCache } = require('../utils/leaderboardCache');
const xlsx = require('xlsx');
const { generateCertificatePDF } = require('../utils/pdfGenerator');
const path = require('path');
const fs = require('fs-extra');

/**
 * @desc    Upload a new certificate
 * @route   POST /api/certificates/upload
 * @access  Private (Logged-in users)
 */
const uploadCertificate = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { club_id, position, event_date, event_name } = req.body;
    let file_url = null;

    if (req.file) {
      file_url = `/uploads/${req.file.filename}`;
    }

    if (!club_id || !position || !event_date || !file_url || !event_name) {
      res.status(400); 
      throw new Error('Please provide club_id, event_name, position, event_date, and file.');
    }

    const validPositions = ['winner', 'runnerup1', 'runnerup2', 'participant'];
    if (!validPositions.includes(position.toLowerCase())) {
      res.status(400);
      throw new Error('Invalid position.');
    }

    // Check if user already has a pending or approved certificate for this exact event to prevent spam
    const [existing] = await db.query(
      'SELECT id FROM certificates WHERE user_id = ? AND club_id = ? AND event_name = ? AND event_date = ? AND status IN ("pending", "approved")',
      [userId, club_id, event_name, event_date]
    );

    if (existing.length > 0) {
      res.status(400);
      throw new Error('You have already uploaded a certificate for this event.');
    }

    const insertQuery = `
      INSERT INTO certificates (user_id, club_id, event_name, position, event_date, file_url, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `;

    const [result] = await db.query(insertQuery, [
      userId, 
      club_id, 
      event_name,
      position.toLowerCase(), 
      event_date, 
      file_url
    ]);

    res.status(201).json({
      success: true,
      message: 'Certificate uploaded successfully',
      data: { certificateId: result.insertId, file_url }
    });
  } catch (error) {
    next(error); 
  }
};

/**
 * @desc    Get logged in user's certificates
 * @route   GET /api/certificates/my-certificates
 */
const getStudentCertificates = async (req, res, next) => {
  try {
    const query = `
      SELECT c.*, cl.name as club_name 
      FROM certificates c
      LEFT JOIN clubs cl ON c.club_id = cl.id
      WHERE c.user_id = ?
      ORDER BY c.created_at DESC
    `;
    const [certs] = await db.query(query, [req.user.id]);
    res.status(200).json({ success: true, count: certs.length, data: certs });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Bulk generate certificates (Admin only)
 * @route   POST /api/certificates/bulk-generate
 * @access  Private (Admin)
 */
const bulkGenerateCertificates = async (req, res, next) => {
  try {
    const { event_name, event_date, position, pastedData } = req.body;
    let studentData = [];

    // Always fetch fresh club_id and name from DB (avoids stale JWT token issues)
    const [clubRows] = await db.query(
      'SELECT c.id, c.name FROM clubs c JOIN users u ON u.club_id = c.id WHERE u.id = ?', 
      [req.user.id]
    );
    const club_id = clubRows[0]?.id;
    const clubName = clubRows[0]?.name;

    // Validations
    if (!club_id) {
      res.status(403);
      throw new Error('User does not have an assigned club. Please ask a super admin to assign your club.');
    }

    if (!event_name || !event_date || !position) {
      res.status(400);
      throw new Error('Please provide event_name, event_date, and position.');
    }

    const pointsMap = {
      winner: 50,
      runnerup1: 35,
      runnerup2: 20,
      participant: 10
    };

    const points = pointsMap[position.toLowerCase()];
    if (!points) {
      res.status(400);
      throw new Error('Invalid position.');
    }

    // Parse Data
    if (req.file) {
      // Excel upload
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      studentData = xlsx.utils.sheet_to_json(worksheet);
    } else if (pastedData) {
      // JSON or CSV-like pasted data
      if (typeof pastedData === 'string') {
        // ── CSV Parsing with Validation ───────────────────────────────────
        // Expected columns (positional): Name, ERP, Branch, Course, Semester, College
        const EXPECTED_FIELDS = 6;
        const MIN_REQUIRED    = 2; // At minimum Name + ERP must be present

        const lines = pastedData.trim().split('\n');
        const skipped = [];

        studentData = lines.reduce((acc, rawLine, lineIndex) => {
          const trimmedLine = rawLine.trim();

          // Skip blank lines
          if (!trimmedLine) return acc;

          const parts = trimmedLine.split(',').map(s => s.trim());

          // Skip rows that don't have the minimum required fields
          if (parts.length < MIN_REQUIRED || !parts[1]) {
            skipped.push({ line: lineIndex + 1, raw: trimmedLine, error: `Expected at least ${MIN_REQUIRED} fields, got ${parts.length}` });
            return acc;
          }

          // Safely map fields — missing positions default to '' (never undefined)
          acc.push({
            Name:     parts[0] || '',
            ERP:      parts[1] || '',
            Branch:   parts[2] || '',
            Course:   parts[3] || '',
            Semester: parts[4] || '',
            College:  parts[5] || ''
          });

          return acc;
        }, []);

        // Attach skipped-row info to results so caller can inspect them
        if (skipped.length > 0) {
          console.warn(`[CSV] Skipped ${skipped.length} malformed row(s):`, skipped);
        }
      } else {
        studentData = pastedData;
      }
    }

    if (studentData.length === 0) {
      res.status(400);
      throw new Error('No student data provided.');
    }

    // Process Students
    const results = {
      success: [],
      failed: []
    };

    // Create Batch record
    const [batchResult] = await db.query(
      'INSERT INTO certificate_batches (club_id, position, event_name) VALUES (?, ?, ?)',
      [club_id, position.toLowerCase(), event_name]
    );

    for (const student of studentData) {
      try {
        const erp = student.ERP || student.erp;
        const name = student.Name || student.name;

        if (!erp) {
          results.failed.push({ student, error: 'Missing ERP' });
          continue;
        }

        // Find user in DB — always use DB college (never a hardcoded fallback)
        const [users] = await db.query(
          'SELECT id, name, course, branch, semester, college FROM users WHERE erp = ?',
          [erp]
        );
        
        if (users.length === 0) {
          results.failed.push({ student, error: 'User not found in system via ERP' });
          continue;
        }

        const userId     = users[0].id;
        const studentName = users[0].name || name;
        // College is ALWAYS sourced from the student's own profile in the DB
        const college    = users[0].college || '________________';
        
        // Generate a unique Certificate ID
        const certId = `CR-${erp}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        // Generate PDF — all data sourced from DB; certId passed for tracking
        const pdfUrl = await generateCertificatePDF({
          name:       studentName,
          course:     users[0].course    || student.Course  || student.course   || '____________',
          semester:   users[0].semester  || student.Semester|| student.semester || '____________',
          branch:     users[0].branch    || student.Branch  || student.branch   || '____________',
          college,   // Always from DB — student's own college
          event_name,
          position,
          event_date,
          erp,
          issuer: clubName,
          certId
        });

        // Store in e_certificates (display only as per requirement)
        await db.query(
          `INSERT INTO e_certificates 
           (user_id, club_id, event_name, event_date, position, certificate_url, points) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, club_id, event_name, event_date, position.toLowerCase(), pdfUrl, points]
        );

        // 1. Fetch potential existing points to calculate delta (prevent duplicate points)
        const [existing] = await db.query(
          `SELECT points FROM event_participation 
           WHERE user_id = ? AND club_id = ? AND event_name = ? AND event_date = ?`,
          [userId, club_id, event_name, event_date]
        );
        const oldPoints = existing.length > 0 ? existing[0].points : 0;

        // 2. SYNC WITH EVENT_PARTICIPATION (Centralized Points Control)
        // E-Certificate ALWAYS Overrides manual or existing records for the same event
        await db.query(
          `INSERT INTO event_participation 
           (user_id, club_id, event_name, event_date, position, source, points) 
           VALUES (?, ?, ?, ?, ?, 'e_certificate', ?)
           ON DUPLICATE KEY UPDATE
           position = VALUES(position),
           points = VALUES(points),
           source = 'e_certificate'`,
          [userId, club_id, event_name, event_date, position.toLowerCase(), points]
        );

        // 3. Update user total points from central table
        await db.query(
          `UPDATE users 
           SET total_points = (SELECT SUM(points) FROM event_participation WHERE user_id = ?) 
           WHERE id = ?`, 
          [userId, userId]
        );

        results.success.push({ erp, name: studentName, url: pdfUrl });
        
        // 4. NOTIFY STUDENT AND REFRESH CACHE WITH DELTA
        if (oldPoints > 0) {
           if (oldPoints !== points) {
               const diff = points - oldPoints;
               const sign = diff > 0 ? '+' : '';
               createNotification(userId, `Your certificate for ${event_name} was upgraded! 🏆 (${sign}${diff} points)`, 'success', 'E-Certificate Updated');
           } else {
               createNotification(userId, `You received a certificate for ${event_name} 🏆. Points were not added because this event was already counted.`, 'info', 'E-Certificate Received');
           }
        } else {
           createNotification(userId, `You received a certificate for ${event_name}! 🏆 (+${points} points added)`, 'success', 'E-Certificate Received');
        }
        
        updateLeaderboardCache(userId, club_id, points, event_date, oldPoints);
      } catch (error) {
        results.failed.push({ student, error: error.message });
      }
    }

    // LOG ACTION
    logActivity(req.user.id, 'SEND_E_CERT', batchResult.insertId, { event_name, student_count: results.success.length });

    res.status(200).json({
      success: true,
      batchId: batchResult.insertId,
      results
    });

  } catch (error) {
    next(error);
  }
};



/**
 * @desc    Get current user's E-Certificates
 * @route   GET /api/certificates/my-e-certificates
 */
const getMyECertificates = async (req, res, next) => {
  try {
    const query = `
      SELECT ec.*, cl.name as club_name 
      FROM e_certificates ec
      LEFT JOIN clubs cl ON ec.club_id = cl.id
      WHERE ec.user_id = ?
      ORDER BY ec.created_at DESC
    `;
    const [certs] = await db.query(query, [req.user.id]);
    res.status(200).json({ success: true, count: certs.length, data: certs });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current user's Participation History (Centralized)
 * @route   GET /api/certificates/my-participations
 */
const getMyParticipations = async (req, res, next) => {
  try {
    const query = `
      SELECT ep.*, cl.name as club_name 
      FROM event_participation ep
      LEFT JOIN clubs cl ON ep.club_id = cl.id
      WHERE ep.user_id = ?
      ORDER BY ep.event_date DESC
    `;
    const [participations] = await db.query(query, [req.user.id]);
    res.status(200).json({ success: true, count: participations.length, data: participations });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadCertificate,
  getStudentCertificates,
  bulkGenerateCertificates,
  getMyECertificates,
  getMyParticipations
};
