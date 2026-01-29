// Load environment-specific .env file
const path = require("path");
const isDev = process.env.NODE_ENV === "development";
const envFile = isDev ? ".env.development" : ".env";
require("dotenv").config({ path: path.join(__dirname, envFile) });

console.log(`[server] Environment: ${isDev ? "DEVELOPMENT" : "PRODUCTION"}`);
console.log(`[server] Loaded config from: ${envFile}`);
const express = require("express");
const cors = require("cors");
const fs = require("fs");

const overridesRoutes = require("./src/core/overrides");
const assignmentsRoutes = require("./src/core/assignments");
const streamingAuthRoutes = require("./src/routes/streaming-auth");
const onboardingRoutes = require("./src/routes/onboarding");
const updateRoutes = require("./src/routes/update");
const usersRoutes = require("./src/routes/users");
const learnRoutes = require("./src/routes/learn");

// Optional integrations - don't crash if dependencies are missing
let integrationsRoutes = null;
try {
  integrationsRoutes = require("./src/routes/integrations");
} catch (error) {
  console.warn("⚠️  Integrations module not available:", error.message);
  console.warn("   Calendar integrations will be disabled");
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// Default CORS origins for development
const devCorsOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8080",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:8080",
];

// Production should always use CLIENT_ORIGIN env var
const corsOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((value) => value.trim())
  : isDev
    ? devCorsOrigins
    : ["https://ditchcanvas.com"]; // Fallback for production

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  }),
);

app.use(express.json());

// Setup Socket.IO and viewer proxies BEFORE other routes
const httpProxy = require("http-proxy");
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

// Proxy for Socket.IO (preserve path)
const socketIoProxy = httpProxy.createProxyServer({
  target: `http://localhost:${STREAMING_PORT}/socket.io`,
  ws: true,
  changeOrigin: true,
  ignorePath: false,
  prependPath: false, // keep existing path/query (express strips mount)
});

// Debug path for socket.io proxy
socketIoProxy.on("proxyReq", (proxyReq, req) => {
  console.log("[server] socket.io proxy path:", proxyReq.path || req.url);
});

// Proxy for viewer (serve root of streaming server)
const viewerProxy = httpProxy.createProxyServer({
  target: `http://localhost:${STREAMING_PORT}`,
  ws: true,
  changeOrigin: true,
  ignorePath: true, // always proxy to '/'
});

// Proxy Socket.IO requests (both HTTP and WebSocket polling)
app.use("/socket.io", (req, res) => {
  // Restore the /socket.io prefix stripped by Express mount
  req.url = "/socket.io" + req.url;
  socketIoProxy.web(req, res, (error) => {
    console.error("[server] Socket.IO proxy error:", error);
    if (!res.headersSent) {
      res.status(502).json({ error: "Streaming server not available" });
    }
  });
});

app.use("/api/overrides", overridesRoutes);
app.use("/api/assignments", assignmentsRoutes);
app.use("/api/streaming-auth", streamingAuthRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/update", updateRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/learn", learnRoutes);

// Only add integrations routes if module is available
if (integrationsRoutes) {
  app.use("/api/integrations", integrationsRoutes);
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

const clientDist = path.join(__dirname, "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: "API endpoint not found" });
    }
    return res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.json({
      message:
        "Client build not found. Run `npm run build` inside the client directory to generate it.",
    });
  });
}

app.use((err, _req, res, _next) => {
  console.error("Unhandled server error:", err);
  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Only start the server if running directly (not when imported as module)
if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });

  // Handle WebSocket upgrades for streaming auth proxy
  server.on("upgrade", (req, socket, head) => {
    // Proxy WebSocket upgrades for Socket.IO and streaming-auth
    if (req.url.startsWith("/socket.io/")) {
      socketIoProxy.ws(req, socket, head, (error) => {
        console.error("[server] Socket.IO WS proxy error:", error);
        socket.end();
      });
    } else if (req.url.startsWith("/api/streaming-auth/viewer")) {
      viewerProxy.ws(req, socket, head, (error) => {
        console.error("[server] Viewer WS proxy error:", error);
        socket.end();
      });
    } else {
      socket.destroy();
    }
  });
}

// Export app for Vercel serverless functions
module.exports = app;
