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
const streamingAuthRoutes = require('./src/routes/streaming-auth');
const fileOrganizationRoutes = require('./src/routes/file-organization');

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

// Setup Socket.IO and viewer proxies BEFORE other routes
const httpProxy = require('http-proxy');
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

// Proxy for Socket.IO (preserve path)
const socketIoProxy = httpProxy.createProxyServer({
  target: `http://localhost:${STREAMING_PORT}/socket.io`,
  ws: true,
  changeOrigin: true,
  ignorePath: false,
  prependPath: false // keep existing path/query (express strips mount)
});

// Debug path for socket.io proxy
socketIoProxy.on('proxyReq', (proxyReq, req) => {
  console.log('[server] socket.io proxy path:', proxyReq.path || req.url);
});

// Proxy for viewer (serve root of streaming server)
const viewerProxy = httpProxy.createProxyServer({
  target: `http://localhost:${STREAMING_PORT}`,
  ws: true,
  changeOrigin: true,
  ignorePath: true, // always proxy to '/'
});

// Proxy Socket.IO requests (both HTTP and WebSocket polling)
app.use('/socket.io', (req, res) => {
  // Restore the /socket.io prefix stripped by Express mount
  req.url = '/socket.io' + req.url;
  socketIoProxy.web(req, res, (error) => {
    console.error('[server] Socket.IO proxy error:', error);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Streaming server not available' });
    }
  });
});

app.use('/api/cookies', cookieRoutes);
app.use('/api/overrides', overridesRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vnc-auth', vncAuthRoutes);
app.use('/api/streaming-auth', streamingAuthRoutes);
app.use('/api', fileOrganizationRoutes);

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

const server = app.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

// Handle WebSocket upgrades for streaming auth proxy
server.on('upgrade', (req, socket, head) => {
  // Proxy WebSocket upgrades for Socket.IO and streaming-auth
  if (req.url.startsWith('/socket.io/')) {
    socketIoProxy.ws(req, socket, head, (error) => {
      console.error('[server] Socket.IO WS proxy error:', error);
      socket.end();
    });
  } else if (req.url.startsWith('/api/streaming-auth/viewer')) {
    viewerProxy.ws(req, socket, head, (error) => {
      console.error('[server] Viewer WS proxy error:', error);
      socket.end();
    });
  } else {
    socket.destroy();
  }
});
