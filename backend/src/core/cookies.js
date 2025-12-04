const express = require('express');
const CookieManager = require('./cookie-manager');

const router = express.Router();
const cookieManager = new CookieManager();

router.get('/', async (_req, res) => {
  try {
    const data = await cookieManager.loadCookies();
    if (!data) {
      return res.json({ success: true, data: null });
    }
    return res.json({ success: true, data });
  } catch (error) {
    console.error('GET /cookies error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load saved cookies' },
    });
  }
});

router.get('/status', (_req, res) => {
  try {
    const info = cookieManager.getCookieInfo();
    return res.json({ success: true, data: info });
  } catch (error) {
    console.error('GET /cookies/status error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load cookie status' },
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { cookies, metadata } = req.body ?? {};
    if (!Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'A non-empty cookies array is required' },
      });
    }
    const success = await cookieManager.saveCookies(cookies, metadata);
    if (!success) {
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to persist cookies' },
      });
    }
    const status = cookieManager.getCookieInfo();
    return res.status(201).json({ success: true, data: status });
  } catch (error) {
    console.error('POST /cookies error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save cookies' },
    });
  }
});

router.delete('/', (_req, res) => {
  try {
    const removed = cookieManager.clearCookies();
    return res.json({
      success: true,
      data: { removed },
    });
  } catch (error) {
    console.error('DELETE /cookies error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to clear cookies' },
    });
  }
});

module.exports = router;
