const express = require('express');
const { createAuthSession, getStatus, releaseSession } = require('../core/canvas-auth-service');

const router = express.Router();

// POST /api/auth/canvas/authenticate
router.post('/canvas/authenticate', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await createAuthSession({ email });
    res.json(result);
  } catch (error) {
    console.error('Canvas authentication error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to start Canvas authentication' 
    });
  }
});

// POST /api/auth/canvas/login
router.post('/canvas/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ 
        success: false,
        error: 'Email is required' 
      });
    }
    const result = await createAuthSession({ email });
    res.json(result);
  } catch (error) {
    console.error('Canvas login error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to start Canvas login' 
    });
  }
});

// GET /api/auth/canvas/status/:token
router.get('/canvas/status/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const status = await getStatus(token);
    if (!status) {
      return res.status(404).json({ 
        success: false,
        error: 'Session not found' 
      });
    }
    res.json(status);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to check status' 
    });
  }
});

// POST /api/auth/canvas/release/:token
router.post('/canvas/release/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const released = await releaseSession(token);
    if (!released) {
      return res.status(404).json({ 
        success: false,
        error: 'Session not found or already released' 
      });
    }
    res.json({ 
      success: true,
      message: 'Session released successfully' 
    });
  } catch (error) {
    console.error('Release session error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to release session' 
    });
  }
});

module.exports = router;
