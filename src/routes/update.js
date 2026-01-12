/**
 * Update Routes
 * Triggers background Canvas data updates after user login
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Track active update processes per user
const activeUpdates = new Map();

/**
 * POST /api/update/start
 * Triggers background update for a user
 * Body: { email: string }
 */
router.post('/start', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Check if update is already running for this user
  if (activeUpdates.has(email)) {
    const existing = activeUpdates.get(email);
    return res.json({
      success: true,
      message: 'Update already in progress',
      updateId: existing.id,
      startedAt: existing.startedAt
    });
  }

  const updateId = `update-${Date.now()}`;
  const startedAt = new Date().toISOString();

  console.log(`[update] Starting background update for ${email} (${updateId})`);

  // Check if the update script and its dependencies exist
  const updateScript = path.join(__dirname, '../../scripts/utils/update.js');
  const extractorPath = path.join(__dirname, '../../src/crawler/extractors/assignment-extractor.js');

  if (!fs.existsSync(updateScript)) {
    console.warn(`[update] Update script not found: ${updateScript}`);
    return res.json({
      success: false,
      message: 'Update functionality not available - script not found'
    });
  }

  if (!fs.existsSync(extractorPath)) {
    console.warn(`[update] Extractors not found - update requires canvas-extraction modules`);
    return res.json({
      success: true,
      message: 'Update skipped - extractor modules not available (requires canvas-extraction repo)',
      updateId,
      startedAt,
      skipped: true
    });
  }

  const updateProcess = spawn('node', [updateScript], {
    cwd: path.join(__dirname, '../..'),
    env: {
      ...process.env,
      EXTRACTION_EMAIL: email,
      UPDATE_USER_EMAIL: email,
      // Run in background mode - don't block
      UPDATE_BACKGROUND: 'true'
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Track the update
  const updateInfo = {
    id: updateId,
    email,
    startedAt,
    pid: updateProcess.pid,
    status: 'running',
    logs: [],
    completedAt: null,
    error: null
  };

  activeUpdates.set(email, updateInfo);

  // Capture stdout
  updateProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    updateInfo.logs.push(...lines.slice(-50)); // Keep last 50 lines
    // Trim logs if too many
    if (updateInfo.logs.length > 100) {
      updateInfo.logs = updateInfo.logs.slice(-50);
    }
  });

  // Capture stderr
  updateProcess.stderr.on('data', (data) => {
    console.error(`[update] ${email} stderr:`, data.toString());
    updateInfo.logs.push(`[ERROR] ${data.toString()}`);
  });

  // Handle completion
  updateProcess.on('close', (code) => {
    console.log(`[update] ${email} completed with code ${code}`);
    updateInfo.status = code === 0 ? 'completed' : 'failed';
    updateInfo.completedAt = new Date().toISOString();
    if (code !== 0) {
      updateInfo.error = `Process exited with code ${code}`;
    }

    // Remove from active updates after 5 minutes (allow status checks)
    setTimeout(() => {
      if (activeUpdates.get(email)?.id === updateId) {
        activeUpdates.delete(email);
      }
    }, 5 * 60 * 1000);
  });

  updateProcess.on('error', (err) => {
    console.error(`[update] ${email} error:`, err);
    updateInfo.status = 'failed';
    updateInfo.error = err.message;
    updateInfo.completedAt = new Date().toISOString();
  });

  // Don't wait for the process - let it run in background
  updateProcess.unref();

  res.json({
    success: true,
    message: 'Update started in background',
    updateId,
    startedAt
  });
});

/**
 * GET /api/update/status/:email
 * Check update status for a user
 */
router.get('/status/:email', (req, res) => {
  const { email } = req.params;

  const updateInfo = activeUpdates.get(email);

  if (!updateInfo) {
    return res.json({
      hasActiveUpdate: false,
      message: 'No active or recent update found'
    });
  }

  res.json({
    hasActiveUpdate: updateInfo.status === 'running',
    updateId: updateInfo.id,
    status: updateInfo.status,
    startedAt: updateInfo.startedAt,
    completedAt: updateInfo.completedAt,
    error: updateInfo.error,
    recentLogs: updateInfo.logs.slice(-10) // Last 10 log lines
  });
});

/**
 * POST /api/update/stop/:email
 * Stop an active update (if possible)
 */
router.post('/stop/:email', (req, res) => {
  const { email } = req.params;

  const updateInfo = activeUpdates.get(email);

  if (!updateInfo || updateInfo.status !== 'running') {
    return res.json({
      success: false,
      message: 'No active update to stop'
    });
  }

  try {
    // Try to kill the process
    process.kill(updateInfo.pid, 'SIGTERM');
    updateInfo.status = 'stopped';
    updateInfo.completedAt = new Date().toISOString();

    res.json({
      success: true,
      message: 'Update stopped'
    });
  } catch (err) {
    res.json({
      success: false,
      message: `Failed to stop update: ${err.message}`
    });
  }
});

module.exports = router;
