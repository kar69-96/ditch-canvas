require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const cookieRoutes = require('./src/core/cookies');
const overridesRoutes = require('./src/core/overrides');
const assignmentsRoutes = require('./src/core/assignments');
const authRoutes = require('./src/routes/auth');
const vncAuthRoutes = require('./src/routes/vnc-auth');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(',').map((value) => value.trim())
      : [
          'http://localhost:3000',
          'http://localhost:5173',
          'http://127.0.0.1:5173',
        ],
    credentials: true,
  })
);

app.use(express.json());

app.use('/api/cookies', cookieRoutes);
app.use('/api/overrides', overridesRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vnc-auth', vncAuthRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

const clientDist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    return res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      message: 'Client build not found. Run `npm run build` inside the client directory to generate it.',
    });
  });
}

app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
