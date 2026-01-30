// Vercel serverless function for starting streaming auth
const https = require("https");
const http = require("http");

/**
 * Check streaming server health before returning URL to frontend
 * @param {string} tunnelUrl - URL to the streaming server
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns {Promise<{healthy: boolean, activeSessions?: number, error?: string}>}
 */
function checkStreamingHealth(tunnelUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const url = new URL("/health", tunnelUrl);
      const httpModule = url.protocol === "https:" ? https : http;

      const req = httpModule.request(url, { timeout: timeoutMs }, (res) => {
        if (res.statusCode === 200) {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              resolve({
                healthy: data.status === "ok",
                activeSessions: data.activeSessions,
              });
            } catch {
              resolve({ healthy: false, error: "Invalid health response" });
            }
          });
        } else {
          resolve({ healthy: false, error: `HTTP ${res.statusCode}` });
        }
      });

      req.on("error", (err) => resolve({ healthy: false, error: err.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ healthy: false, error: "Health check timeout" });
      });
      req.end();
    } catch (err) {
      resolve({ healthy: false, error: err.message });
    }
  });
}

// EC2 Manager configuration
const EC2_MANAGER_ENABLED = process.env.EC2_MANAGER_ENABLED === "true";
const EC2_MANAGER_URL =
  process.env.EC2_MANAGER_URL || "https://api.ditchcanvas.com";

/**
 * Make HTTP request to EC2 Manager
 */
function requestAssignment(email, context) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/ec2-manager/assign", EC2_MANAGER_URL);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    const body = JSON.stringify({ email, context });

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    };

    const req = httpModule.request(options, (res) => {
      let responseBody = "";

      res.on("data", (chunk) => {
        responseBody += chunk;
      });

      res.on("end", () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve(parsed);
        } catch {
          reject(new Error(`Invalid response: ${responseBody}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, context = "login" } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Try EC2 Manager for dynamic instance assignment
    if (EC2_MANAGER_ENABLED) {
      console.log("[streaming-auth] Using EC2 Manager for dynamic assignment");

      try {
        const assignment = await requestAssignment(normalizedEmail, context);

        if (assignment.success && assignment.tunnelUrl) {
          // Successfully assigned to an instance
          console.log(
            `[streaming-auth] Assigned to instance ${assignment.instanceId}`,
          );
          // Append email to URL for session isolation
          const urlWithEmail = `${assignment.tunnelUrl}?email=${encodeURIComponent(normalizedEmail)}`;
          return res.json({
            success: true,
            url: urlWithEmail,
            streamingServerUrl: assignment.tunnelUrl,
            instanceId: assignment.instanceId,
            requestId: assignment.requestId,
            message: "Assigned to streaming instance",
          });
        }

        if (assignment.queued) {
          // Request was queued - return queue position
          console.log(
            `[streaming-auth] Request queued at position ${assignment.position}`,
          );
          return res.status(202).json({
            success: true,
            queued: true,
            requestId: assignment.requestId,
            position: assignment.position,
            estimatedWaitSeconds: assignment.estimatedWaitSeconds,
            message: `Your request is queued at position ${assignment.position}. An instance is being prepared.`,
          });
        }

        // EC2 Manager returned an error, fall back to static URL
        console.warn(
          "[streaming-auth] EC2 Manager assignment failed:",
          assignment.error,
        );
      } catch (error) {
        console.error("[streaming-auth] EC2 Manager error:", error.message);
        // Fall through to static URL fallback
      }
    }

    // Fallback: Use DEDICATED_TUNNEL_URL or STREAMING_SERVER_URL
    const streamingUrl =
      process.env.DEDICATED_TUNNEL_URL || process.env.STREAMING_SERVER_URL;

    if (!streamingUrl) {
      return res.status(500).json({
        success: false,
        error: "Streaming server not configured",
      });
    }

    console.log(
      "[streaming-auth] Using static streaming server URL:",
      streamingUrl,
    );

    // Health check before returning URL
    try {
      const healthCheck = await checkStreamingHealth(streamingUrl);
      if (!healthCheck.healthy) {
        console.error(
          `[streaming-auth] Streaming server health check failed: ${healthCheck.error}`,
        );
        return res.status(503).json({
          success: false,
          error: "Authentication server is currently unavailable",
          details: healthCheck.error,
          retryAfterSeconds: 10,
        });
      }
      console.log(
        `[streaming-auth] Streaming server healthy (${healthCheck.activeSessions || 0} active sessions)`,
      );
    } catch (healthErr) {
      console.error("[streaming-auth] Health check error:", healthErr.message);
      // Continue anyway - health check is best-effort
    }

    // Append email to URL for session isolation
    const urlWithEmail = `${streamingUrl}?email=${encodeURIComponent(normalizedEmail)}`;

    // Return the tunnel URL directly (not proxied through Vercel)
    return res.json({
      success: true,
      url: urlWithEmail,
      streamingServerUrl: streamingUrl,
      message: "Streaming server ready",
    });
  } catch (error) {
    console.error("Streaming auth start error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
