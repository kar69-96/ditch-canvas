const express = require('express');
const OverridesService = require('./overrides-service');

const router = express.Router();
const overridesService = new OverridesService();

router.get('/:assignmentId', async (req, res) => {
  try {
    const map = await overridesService.getOverridesMap();
    const payload = map.get(req.params.assignmentId) || null;
    return res.json({
      success: true,
      data: overridesService.formatOverride(req.params.assignmentId, payload),
    });
  } catch (error) {
    console.error('GET /overrides error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to load assignment override' },
    });
  }
});

router.put('/:assignmentId', async (req, res) => {
  try {
    const { status, reason } = req.body ?? {};
    if (typeof status !== 'string' || status.trim() === '') {
      return res.status(400).json({
        success: false,
        error: { message: 'Override status is required' },
      });
    }
    const result = await overridesService.setOverride(req.params.assignmentId, status, reason);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('PUT /overrides error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to save assignment override' },
    });
  }
});

router.delete('/:assignmentId', async (req, res) => {
  try {
    const result = await overridesService.removeOverride(req.params.assignmentId);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('DELETE /overrides error:', error);
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to remove assignment override' },
    });
  }
});

module.exports = router;
