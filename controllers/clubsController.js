const db = require('../config/db');

exports.getClubs = async (req, res, next) => {
  try {
    const [clubs] = await db.query('SELECT * FROM clubs ORDER BY name ASC');
    res.json({ success: true, count: clubs.length, data: clubs });
  } catch (err) { next(err); }
};

exports.createClub = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Please provide a club name' });
    const [result] = await db.query('INSERT INTO clubs (name) VALUES (?)', [name]);
    res.json({ success: true, data: { id: result.insertId, name } });
  } catch (err) { next(err); }
};

exports.deleteClub = async (req, res, next) => {
  try {
    const [result] = await db.query('DELETE FROM clubs WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Club not found' });
    res.json({ success: true, message: 'Club deleted' });
  } catch (err) { next(err); }
};
