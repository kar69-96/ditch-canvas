// Vercel serverless function wrapper for Express app
const path = require('path');

// Load environment variables from root .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');

const app = express();

// CORS configuration
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(',').map((value) => value.trim())
      : '*',
    credentials: true,
  })
);

app.use(express.json());

// Import routes
const overridesRoutes = require('../src/core/overrides');
const assignmentsRoutes = require('../src/core/assignments');
const streamingAuthRoutes = require('../src/routes/streaming-auth');
const onboardingRoutes = require('../src/routes/onboarding');

// Optional integrations - don't crash if dependencies are missing
let integrationsRoutes = null;
try {
  integrationsRoutes = require('../src/routes/integrations');
} catch (error) {
  console.warn('⚠️  Integrations module not available:', error.message);
  console.warn('   Calendar integrations will be disabled');
}

// Mount routes with /api prefix for Vercel routing
app.use('/api/overrides', overridesRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/streaming-auth', streamingAuthRoutes);
app.use('/api/onboarding', onboardingRoutes);

// Only add integrations routes if module is available
if (integrationsRoutes) {
  app.use('/api/integrations', integrationsRoutes);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Root path for debugging
app.all('*', (req, res) => {
  res.json({
    message: 'API is running',
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Export handler for Vercel serverless functions
module.exports = (req, res) => {
  // Let Express handle the request
  app(req, res);
};

