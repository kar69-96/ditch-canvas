const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'assignments.json');

async function listAssignments() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return [];
  }
}

router.get('/', async (_req, res) => {
  try {
    const assignments = await listAssignments();
    return res.json({ success: true, data: assignments });
  } catch (error) {
    console.error('GET /assignments error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load assignments' },
    });
  }
});

module.exports = router;
