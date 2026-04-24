const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

/**
 * @desc    Register a new user
 * @route   POST /api/auth/signup
 * @access  Public
 */
const signup = async (req, res, next) => {
  try {
    const { name, erp, email, password, course, branch, semester, college } = req.body;

    // 1. Validate input
    if (!name || !erp || !email || !password) {
      res.status(400); // Bad Request
      throw new Error('Please provide name, erp, email, and password.');
    }

    // 2. Check if user already exists
    const [existingUsers] = await db.query(
      'SELECT * FROM users WHERE email = ? OR erp = ?',
      [email, erp]
    );

    if (existingUsers.length > 0) {
      res.status(400);
      throw new Error('User with this email or ERP already exists.');
    }

    // 3. Hash the password using bcrypt
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 4. Insert user into MySQL 'users' table
    // Role is naturally defaulted to 'student' in the DB Schema
    const insertQuery = `
      INSERT INTO users (name, erp, email, password, role, course, branch, semester, college)
      VALUES (?, ?, ?, ?, 'student', ?, ?, ?, ?)
    `;
    const [result] = await db.query(insertQuery, [name, erp, email, hashedPassword, course || null, branch || null, semester || null, college || 'Not Specified']);

    // 5. Return success message
    res.status(201).json({
      success: true,
      message: 'User registered successfully!',
      data: {
        userId: result.insertId,
      }
    });
  } catch (error) {
    next(error); // Pass to custom error handling middleware
  }
};

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Validate input
    if (!email || !password) {
      res.status(400);
      throw new Error('Please provide email and password.');
    }

    // 2. Check user exists
    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      res.status(401); // Unauthorized
      throw new Error('Invalid email or password.');
    }

    const user = users[0];

    // 3. Compare hashed password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      res.status(401);
      throw new Error('Invalid email or password.');
    }

    // 4. Generate JWT payload
    const payload = {
      id: user.id,
      role: user.role,
      club_id: user.club_id
    };

    // 5. Create JWT Token
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '30d' } // Expires in 30 days
    );

    // 6. Return token and user resource
    res.status(200).json({
      success: true,
      message: 'Successfully logged in',
      token,
      user: {
        id: user.id,
        name: user.name,
        erp: user.erp,
        email: user.email,
        role: user.role,
        course: user.course,
        branch: user.branch,
        semester: user.semester,
        college: user.college,
        avatar_url: user.avatar_url,
        total_points: user.total_points || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { name, email, password, course, branch, semester, college } = req.body;

    if (!name || !email) { res.status(400); throw new Error('Name and email are required'); }
    
    let query = 'UPDATE users SET name = ?, email = ?, course = ?, branch = ?, semester = ?, college = ? WHERE id = ?';
    let params = [name, email, course, branch, semester, college, userId];

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = 'UPDATE users SET name = ?, email = ?, course = ?, branch = ?, semester = ?, college = ?, password = ? WHERE id = ?';
      params = [name, email, course, branch, semester, college, hashedPassword, userId];
    }

    await db.query(query, params);
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch(err) { next(err); }
};

const { getBadge, getNextBadge } = require('../utils/badgeHelper');

/**
 * @desc    Get user profile with points and badges
 * @route   GET /api/auth/profile
 * @access  Private
 */
const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [users] = await db.query('SELECT name, erp, email, role, course, branch, semester, college, avatar_url, club_id, COALESCE(total_points, 0) as total_points FROM users WHERE id = ?', [userId]);

    if (users.length === 0) {
      res.status(404);
      throw new Error('User not found');
    }

    const user = users[0];
    const badge = getBadge(user.total_points);
    const nextBadge = getNextBadge(user.total_points);

    res.json({
      success: true,
      data: {
        ...user,
        badge,
        nextBadge
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  signup,
  login,
  updateProfile,
  getProfile
};
