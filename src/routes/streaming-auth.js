const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const httpProxy = require("http-proxy");
const { createClient } = require("@supabase/supabase-js");
const { getSupabaseConfig } = require("../core/config");
const {
  getCookieFilename,
  getMainCookieFile,
  copyCookiesToMainFile,
  OUTPUT_DIR,
} = require("../utils/cookie-helpers");
const ec2Manager = require("../services/ec2-manager/client");

const router = express.Router();

// Determine streaming server target based on environment
const getStreamingTarget = () => {
  // In production (Vercel), use external streaming server if configured
  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production";
  if (isProduction && process.env.STREAMING_SERVER_URL) {
    return process.env.STREAMING_SERVER_URL;
  }
  // Otherwise use localhost
  return `http://localhost:${process.env.STREAMING_PORT || 3002}`;
};

// Create proxy instance for streaming server
const streamingProxy = httpProxy.createProxyServer({
  target: getStreamingTarget(),
  ws: true, // Enable WebSocket proxying
  changeOrigin: true,
});

// Handle proxy request to preserve query string
streamingProxy.on("proxyReq", (proxyReq, req) => {
  // The req.url has already been rewritten in the viewer handler
  // Just ensure it's set correctly on the proxy request
  if (req.url) {
    proxyReq.path = req.url;
  }
});

// Store active streaming processes
const activeStreamingProcesses = new Map();
// Store extraction results by email
const extractionResults = new Map();
// Store session start times by email
const sessionStartTimes = new Map();
// Store context (login/onboarding) for each email
const extractionContext = new Map(); // 'login' or 'onboarding'
// Store active AWS update processes to prevent multiple simultaneous runs
const activeAwsUpdateProcesses = new Set();
// Track last AWS update time to prevent excessive updates
let lastAwsUpdateTime = null;
// AWS update cooldown period in milliseconds (default: 1 hour)
const AWS_UPDATE_COOLDOWN =
  parseInt(process.env.AWS_UPDATE_COOLDOWN_MINUTES || "60") * 60 * 1000;

// Default streaming port (internal)
const STREAMING_PORT = process.env.STREAMING_PORT || 3002;

// Initialize Supabase client
const supabaseConfig = getSupabaseConfig();
const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey);

/**
 * Save cookies to Supabase user record
 * @param {string} email - User email
 * @param {Array} cookies - Array of cookie objects
 * @returns {Promise<void>}
 */
async function saveCookiesToSupabase(email, cookies) {
  const normalizedEmail = email.toLowerCase().trim();

  // Find user by email
  const { data: user, error: findError } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .single();

  if (findError || !user) {
    throw new Error(`User not found: ${normalizedEmail}`);
  }

  // Update user record with new cookies
  const { error: updateError } = await supabase
    .from("users")
    .update({
      canvas_cookies: cookies,
      canvas_cookies_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    throw new Error(
      `Failed to update cookies in Supabase: ${updateError.message}`,
    );
  }

  console.log(
    `[streaming-auth] ✅ Updated cookies in Supabase for user: ${normalizedEmail}`,
  );
}

/**
 * POST /api/streaming-auth/start
 * Starts the streaming server and returns a proxied URL on port 3000
 */
router.post("/start", async (req, res) => {
  try {
    const { email, forceReauth, context } = req.body; // context: 'login' or 'onboarding'

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const extractionContextValue = context || "login"; // Default to 'login' for backward compatibility

    // Clear any old extraction results and session data for this email
    extractionResults.delete(normalizedEmail);
    sessionStartTimes.set(normalizedEmail, Date.now());
    extractionContext.set(normalizedEmail, extractionContextValue); // Store context

    // Delete old cookie file for this email
    const cookieFile = getCookieFilename(normalizedEmail);
    if (fs.existsSync(cookieFile)) {
      fs.unlinkSync(cookieFile);
      console.log(
        `[streaming-auth] Cleared old cookie file for ${normalizedEmail}`,
      );
    }

    // In production (Vercel), use external streaming server
    const isProduction =
      process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production";

    // Try EC2 Manager for dynamic instance assignment (when enabled)
    if (isProduction && ec2Manager.isEnabled()) {
      console.log(
        "[streaming-auth] Production mode: using EC2 Manager for dynamic assignment",
      );

      const assignment = await ec2Manager.requestAssignment(
        normalizedEmail,
        extractionContextValue,
      );

      if (assignment.success && assignment.tunnelUrl) {
        // Successfully assigned to an instance
        console.log(
          `[streaming-auth] Assigned to instance ${assignment.instanceId}`,
        );
        // Append email to URL for session isolation, and forceReauth if requested
        const urlWithEmail = `${assignment.tunnelUrl}?email=${encodeURIComponent(normalizedEmail)}${forceReauth ? "&forceReauth=1" : ""}`;
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

      // EC2 Manager failed, fall back to static URL if available
      console.warn(
        "[streaming-auth] EC2 Manager assignment failed, trying fallback",
      );
    }

    // Fallback: Use static STREAMING_SERVER_URL (legacy mode)
    if (isProduction && process.env.STREAMING_SERVER_URL) {
      // Production: return external streaming server URL directly
      // Also return streamingServerUrl for the frontend to poll extraction results
      console.log(
        "[streaming-auth] Production mode: using static streaming server (fallback)",
      );
      // Append email to URL for session isolation, and forceReauth if requested
      const urlWithEmail = `${process.env.STREAMING_SERVER_URL}?email=${encodeURIComponent(normalizedEmail)}${forceReauth ? "&forceReauth=1" : ""}`;
      return res.json({
        success: true,
        url: urlWithEmail,
        streamingServerUrl: process.env.STREAMING_SERVER_URL,
        message: "Using external streaming server",
      });
    }

    // Check if streaming server is already running (localhost only)
    if (activeStreamingProcesses.size > 0) {
      // Reuse existing streaming server
      const baseUrl =
        process.env.BACKEND_URL ||
        `http://localhost:${process.env.PORT || 3000}`;

      // Append email to URL for session isolation
      return res.json({
        success: true,
        url: `${baseUrl}/api/streaming-auth/viewer?email=${encodeURIComponent(normalizedEmail)}`,
        streamingServerUrl: baseUrl,
        message: "Streaming server already running",
      });
    }

    // Path to the streaming script
    const streamingScriptPath = path.join(
      __dirname,
      "..",
      "core",
      "extract-cookies-streaming.js",
    );

    if (!fs.existsSync(streamingScriptPath)) {
      return res.status(500).json({
        success: false,
        error: "Streaming script not found",
      });
    }

    console.log(
      "[streaming-auth] Starting streaming server on port",
      STREAMING_PORT,
    );

    // Spawn the streaming script
    const childProcess = spawn("node", [streamingScriptPath], {
      cwd: path.join(__dirname, "..", ".."),
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      env: {
        ...process.env,
        STREAMING_PORT: String(STREAMING_PORT),
        EXTRACTION_EMAIL: normalizedEmail,
        COOKIE_OUTPUT_FILE: cookieFile, // Email-specific cookie file
        FORCE_REAUTH: forceReauth ? "true" : "false",
      },
    });

    // Store the process
    activeStreamingProcesses.set(normalizedEmail, childProcess);

    // Handle process output
    childProcess.stdout.on("data", (data) => {
      const output = data.toString();
      console.log(`[streaming] ${output.trim()}`);

      // Check for extraction completion - multiple patterns to catch it
      if (
        output.includes("Cookie extraction completed") ||
        output.includes("Login complete") ||
        output.includes("✅ Cookie extraction completed") ||
        output.includes("Cookies saved to:")
      ) {
        console.log(
          "[streaming-auth] Detected cookie extraction completion, checking results...",
        );
        setTimeout(() => {
          checkAndStoreExtractionResults(normalizedEmail);
        }, 2000);
      }
    });

    childProcess.stderr.on("data", (data) => {
      console.error(`[streaming] Error: ${data.toString().trim()}`);
    });

    // Handle process exit - also check for extraction results on exit
    childProcess.on("exit", (code) => {
      console.log(`[streaming] Process exited with code ${code}`);

      // Check for extraction results on exit (in case stdout messages were missed)
      if (code === 0) {
        console.log(
          "[streaming-auth] Streaming process completed successfully, checking for extraction results...",
        );
        setTimeout(() => {
          checkAndStoreExtractionResults(normalizedEmail);
        }, 1000);
      }

      activeStreamingProcesses.delete(normalizedEmail);
      extractionContext.delete(normalizedEmail); // Clean up context on exit
    });

    childProcess.on("error", (error) => {
      console.error(`[streaming] Failed to start process:`, error);
      activeStreamingProcesses.delete(normalizedEmail);
      extractionContext.delete(normalizedEmail); // Clean up context on error
    });

    // Wait for server to start with health check
    console.log("[streaming-auth] Waiting for server to be ready...");

    // Health check function
    const checkServerHealth = () => {
      return new Promise((resolve) => {
        const req = http.request(
          {
            hostname: "localhost",
            port: STREAMING_PORT,
            path: "/health",
            method: "GET",
            timeout: 1000,
          },
          (res) => {
            resolve(res.statusCode === 200);
          },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
        req.end();
      });
    };

    // Try health check up to 10 times (5 seconds total)
    let serverReady = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      serverReady = await checkServerHealth();
      if (serverReady) {
        console.log(`[streaming-auth] Server ready after ${(i + 1) * 500}ms`);
        break;
      }
      console.log(
        `[streaming-auth] Health check ${i + 1}/10 - server not ready yet...`,
      );
    }

    if (!serverReady) {
      console.error("[streaming-auth] Server failed to start within 5 seconds");
      // Kill the process if it exists
      if (childProcess && !childProcess.killed) {
        childProcess.kill();
        activeStreamingProcesses.delete(normalizedEmail);
      }
      return res.status(500).json({
        success: false,
        error: "Streaming server failed to start. Please try again.",
      });
    }

    // Return proxied URL - use production URL on Vercel
    // Determine base URL: Use custom domain in production, or Vercel URL, or localhost
    const baseUrl =
      process.env.BACKEND_URL ||
      (process.env.VERCEL_ENV === "production"
        ? "https://ditchcanvas.com"
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : `http://localhost:${process.env.PORT || 3000}`);

    // In production, if streaming server is external (EC2), return direct URL
    const isProd =
      process.env.VERCEL_ENV === "production" ||
      process.env.NODE_ENV === "production";
    const streamingBaseUrl =
      isProd && process.env.STREAMING_SERVER_URL
        ? process.env.STREAMING_SERVER_URL
        : `${baseUrl}/api/streaming-auth/viewer`;

    // Append email to URL for session isolation
    const streamingUrl = `${streamingBaseUrl}?email=${encodeURIComponent(normalizedEmail)}`;

    res.json({
      success: true,
      url: streamingUrl,
      streamingServerUrl:
        isProd && process.env.STREAMING_SERVER_URL
          ? process.env.STREAMING_SERVER_URL
          : baseUrl,
      message: "Streaming server started",
    });
  } catch (error) {
    console.error("[streaming-auth] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to start streaming server",
    });
  }
});

/**
 * GET /api/streaming-auth/viewer
 * Proxies HTTP requests to the internal streaming server
 */
router.get("/viewer", (req, res) => {
  // Rewrite the path to root for the streaming server, preserving query params (including email)
  const queryString = req.url.includes("?") ? req.url.split("?")[1] : "";
  req.url = queryString ? `/?${queryString}` : "/";
  streamingProxy.web(req, res, (error) => {
    console.error("[streaming-auth] Proxy error:", error);
    if (!res.headersSent) {
      res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
  <title>Streaming Server Starting</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
    }
    h1 { color: #333; margin-bottom: 20px; }
    p { color: #666; line-height: 1.6; }
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
  <script>
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  </script>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>🚀 Starting Streaming Server</h1>
    <p>The authentication server is starting up. This page will automatically refresh in a moment...</p>
    <p style="margin-top: 20px;"><small>If this persists, please close this window and try again.</small></p>
  </div>
</body>
</html>
      `);
    }
  });
});

// WebSocket upgrades are handled at the server level in server.js

/**
 * POST /api/streaming-auth/stop
 * Stops the streaming process for an email
 */
router.post("/stop", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const process = activeStreamingProcesses.get(normalizedEmail);

    if (process && !process.killed) {
      // Give extraction time to complete before killing (up to 10 seconds)
      const maxWaitMs = 10000;
      const checkInterval = 500;
      let waited = 0;

      const waitForExtraction = async () => {
        while (waited < maxWaitMs) {
          // Check if extraction results are available
          if (extractionResults.has(normalizedEmail)) {
            console.log(
              `[streaming-auth] Extraction complete for ${normalizedEmail}, stopping server`,
            );
            break;
          }
          // Also check if cookie file exists
          const cookieFile = getCookieFilename(normalizedEmail);
          if (fs.existsSync(cookieFile)) {
            console.log(
              `[streaming-auth] Cookie file found for ${normalizedEmail}, stopping server`,
            );
            checkAndStoreExtractionResults(normalizedEmail);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, checkInterval));
          waited += checkInterval;
        }

        if (waited >= maxWaitMs) {
          console.log(
            `[streaming-auth] Timeout waiting for extraction, force stopping for ${normalizedEmail}`,
          );
        }

        process.kill();
        activeStreamingProcesses.delete(normalizedEmail);
        extractionContext.delete(normalizedEmail);
      };

      // Start waiting in background and respond immediately
      waitForExtraction();

      res.json({
        success: true,
        message: "Streaming server stopping",
      });
    } else {
      extractionContext.delete(normalizedEmail); // Clean up context even if process not found
      res.json({
        success: true,
        message: "No active streaming server found",
      });
    }
  } catch (error) {
    console.error("Stop streaming error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to stop streaming server",
    });
  }
});

/**
 * DELETE /api/streaming-auth/cookies/:email
 * Deletes cookies for a specific email (used on logout)
 */
router.delete("/cookies/:email", async (req, res) => {
  try {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let deleted = false;

    // 1. Delete cookies from Supabase database
    try {
      const { error: updateError } = await supabase
        .from("users")
        .update({
          canvas_cookies: null,
          canvas_cookies_updated_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("email", normalizedEmail);

      if (updateError) {
        console.error(
          `[streaming-auth] Error clearing cookies in Supabase:`,
          updateError,
        );
      } else {
        deleted = true;
        console.log(
          `[streaming-auth] Cleared cookies in Supabase for ${normalizedEmail}`,
        );
      }
    } catch (dbError) {
      console.error(`[streaming-auth] Supabase error:`, dbError);
    }

    // 2. Delete email-specific cookie file (local backup)
    const cookieFile = getCookieFilename(normalizedEmail);

    if (fs.existsSync(cookieFile)) {
      try {
        fs.unlinkSync(cookieFile);
        deleted = true;
        console.log(
          `[streaming-auth] Deleted cookie file for ${normalizedEmail}`,
        );
      } catch (deleteError) {
        console.error(
          `[streaming-auth] Error deleting cookie file:`,
          deleteError,
        );
      }
    }

    // 3. Clear from memory
    extractionResults.delete(normalizedEmail);
    sessionStartTimes.delete(normalizedEmail);

    // 4. Stop any active streaming process for this email
    const process = activeStreamingProcesses.get(normalizedEmail);
    if (process && !process.killed) {
      process.kill();
      activeStreamingProcesses.delete(normalizedEmail);
    }

    res.json({
      success: true,
      message: deleted
        ? "Cookies deleted successfully"
        : "No cookies found to delete",
      deleted,
    });
  } catch (error) {
    console.error("Delete cookies error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete cookies",
    });
  }
});

/**
 * GET /api/streaming-auth/status
 * Check if streaming server is running
 */
router.get("/status", (req, res) => {
  res.json({
    success: true,
    activeProcesses: activeStreamingProcesses.size,
    port: STREAMING_PORT,
  });
});

/**
 * GET /api/streaming-auth/status/:email
 * Get detailed streaming status for a specific email session
 */
router.get("/status/:email", (req, res) => {
  const { email } = req.params;
  const normalizedEmail = email.toLowerCase().trim();

  const process = activeStreamingProcesses.get(normalizedEmail);
  const hasSession = sessionStartTimes.has(normalizedEmail);
  const sessionStart = sessionStartTimes.get(normalizedEmail);
  const hasResult = extractionResults.has(normalizedEmail);

  res.json({
    success: true,
    email: normalizedEmail,
    hasActiveProcess: !!process && !process.killed,
    hasSession,
    sessionAge: hasSession ? Date.now() - sessionStart : null,
    extractionComplete: hasResult,
    port: STREAMING_PORT,
  });
});

/**
 * POST /api/streaming-auth/check-email
 * Check if email exists in Supabase
 */
router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists in Supabase
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", normalizedEmail)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Error checking email:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to check email",
      });
    }

    const userExists = !!data;

    res.json({
      success: true,
      exists: userExists,
      user: userExists ? data : null,
    });
  } catch (error) {
    console.error("Check email error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check email",
    });
  }
});

/**
 * Validate cookies using the same logic as canvas-crawler.js
 * Also checks if cookies were extracted within the last 24 hours
 */
function validateCookies(cookies, extractedAt = null) {
  if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
    return { valid: false, reason: "No cookies found" };
  }

  // Check for essential Canvas cookies
  const hasSessionCookie = cookies.some(
    (c) =>
      c.name &&
      (c.name.includes("session") ||
        c.name.includes("canvas") ||
        c.name.includes("_session")),
  );

  const hasAuthCookie = cookies.some(
    (c) =>
      c.domain &&
      (c.domain.includes("canvas") ||
        c.domain.includes("colorado.edu") ||
        c.domain.includes("instructure.com")),
  );

  if (!hasSessionCookie && !hasAuthCookie) {
    return {
      valid: false,
      reason: "No valid Canvas authentication cookies found",
    };
  }

  // Check if cookies are expired (if expiration is set)
  const now = Date.now();
  const expiredCookies = cookies.filter((c) => {
    if (c.expires && c.expires !== -1) {
      const expiryTime =
        typeof c.expires === "number"
          ? c.expires * 1000
          : new Date(c.expires).getTime();
      return expiryTime < now;
    }
    return false;
  });

  if (expiredCookies.length === cookies.length) {
    return { valid: false, reason: "All cookies are expired" };
  }

  // Check if cookies are older than 24 hours
  if (extractedAt) {
    const extractionTime = new Date(extractedAt).getTime();
    const hoursSinceExtraction = (now - extractionTime) / (1000 * 60 * 60);

    if (hoursSinceExtraction > 24) {
      return {
        valid: false,
        reason: "Cookies are older than 24 hours and need to be refreshed",
      };
    }
  }

  return { valid: true, reason: null };
}

/**
 * GET /api/streaming-auth/extraction-result/:email
 * Get extraction results for an email
 * Only returns data if cookies are valid
 */
router.get("/extraction-result/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if there's an active session for this email
    const hasActiveSession = sessionStartTimes.has(normalizedEmail);

    // Check in-memory results first
    if (extractionResults.has(normalizedEmail)) {
      const result = extractionResults.get(normalizedEmail);

      // Validate cookies before returning (includes 24-hour check)
      if (result.cookies && Array.isArray(result.cookies)) {
        const cookieValidation = validateCookies(
          result.cookies,
          result.extractedAt,
        );
        if (!cookieValidation.valid) {
          // Clear the invalid result
          extractionResults.delete(normalizedEmail);
          return res.json({
            success: false,
            error: "Cookies are invalid",
            reason: cookieValidation.reason,
            requiresReauth: true,
          });
        }
      }

      return res.json({
        success: true,
        ...result,
      });
    }

    // Check file system for results (email-specific file)
    const outputFile = getCookieFilename(normalizedEmail);

    if (fs.existsSync(outputFile)) {
      try {
        const cookieData = JSON.parse(fs.readFileSync(outputFile, "utf8"));
        const extractedAt = cookieData.metadata?.extractedAt || null;

        // Validate cookies before returning (includes 24-hour check)
        if (cookieData.cookies && Array.isArray(cookieData.cookies)) {
          const cookieValidation = validateCookies(
            cookieData.cookies,
            extractedAt,
          );
          if (!cookieValidation.valid) {
            // Delete the invalid cookie file
            fs.unlinkSync(outputFile);
            console.log(
              `[streaming-auth] Deleted invalid cookie file for ${normalizedEmail}: ${cookieValidation.reason}`,
            );

            return res.json({
              success: false,
              error: "Cookies are invalid",
              reason: cookieValidation.reason,
              requiresReauth: true,
            });
          }
        }

        // Store in memory for future requests
        const result = {
          username:
            cookieData.username || cookieData.metadata?.username || null,
          cookies: cookieData.cookies || [],
          extractedAt: extractedAt,
        };
        extractionResults.set(normalizedEmail, result);

        return res.json({
          success: true,
          ...result,
        });
      } catch (parseError) {
        console.error("Error parsing cookie file:", parseError);
      }
    }

    // No results found - check if there's an active session
    if (!hasActiveSession) {
      return res.json({
        success: false,
        error: "No authentication session found",
        requiresReauth: true,
      });
    }

    // Active session exists but extraction not complete yet
    // Return pending status instead of error
    res.json({
      success: false,
      pending: true,
      message:
        "Authentication in progress. Please complete login in the popup window.",
    });
  } catch (error) {
    console.error("Get extraction result error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get extraction result",
    });
  }
});

/**
 * POST /api/streaming-auth/save-cookies
 * Save cookies to Supabase (called by frontend after extraction from EC2)
 * This is needed in production where EC2 streaming server extracts cookies
 * but doesn't have Supabase credentials to save them directly.
 */
router.post("/save-cookies", async (req, res) => {
  try {
    const { email, cookies } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required",
      });
    }

    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Valid cookies array is required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log(
      `[streaming-auth] Saving cookies to Supabase for ${normalizedEmail} (from frontend)`,
    );

    // Save cookies to Supabase
    await saveCookiesToSupabase(normalizedEmail, cookies);

    res.json({
      success: true,
      message: "Cookies saved to Supabase successfully",
    });
  } catch (error) {
    console.error("[streaming-auth] Error saving cookies:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to save cookies",
    });
  }
});

/**
 * POST /api/streaming-auth/verify-login
 * Verify that extracted username matches email (at least 30%)
 */
router.post("/verify-login", async (req, res) => {
  try {
    const { email, username } = req.body;

    if (!email || !username) {
      return res.status(400).json({
        success: false,
        error: "Email and username are required",
      });
    }

    // Extract identikey from email (e.g., xxxx1235@colorado.edu -> xxxx1235)
    const emailMatch = email.match(/^([^@]+)@colorado\.edu$/i);
    const identikey = emailMatch ? emailMatch[1].toLowerCase() : null;

    if (!identikey) {
      return res.json({
        success: false,
        error: "Invalid email format. Expected identikey@colorado.edu",
      });
    }

    // Normalize username for comparison
    const normalizedUsername = username.toLowerCase().trim();

    // Calculate similarity (simple character-based matching)
    // Check if identikey appears in username or vice versa
    const usernameContainsIdentikey = normalizedUsername.includes(identikey);
    const identikeyContainsUsername = identikey.includes(normalizedUsername);

    // Calculate character overlap percentage
    let matchPercentage = 0;
    if (usernameContainsIdentikey || identikeyContainsUsername) {
      // If one contains the other, it's at least a partial match
      const shorter =
        identikey.length < normalizedUsername.length
          ? identikey
          : normalizedUsername;
      const longer =
        identikey.length >= normalizedUsername.length
          ? identikey
          : normalizedUsername;

      // Count matching characters
      let matchingChars = 0;
      for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) {
          matchingChars++;
        }
      }

      matchPercentage = (matchingChars / shorter.length) * 100;
    } else {
      // Calculate Levenshtein-like similarity
      const commonChars = new Set();
      for (const char of identikey) {
        if (normalizedUsername.includes(char)) {
          commonChars.add(char);
        }
      }
      matchPercentage =
        (commonChars.size /
          Math.max(identikey.length, normalizedUsername.length)) *
        100;
    }

    const isValid = matchPercentage >= 30;

    res.json({
      success: true,
      isValid,
      matchPercentage: Math.round(matchPercentage * 100) / 100,
      identikey,
      username: normalizedUsername,
    });
  } catch (error) {
    console.error("Verify login error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to verify login",
    });
  }
});

/**
 * Run AWS update script in the background
 * This runs asynchronously and doesn't block the login flow
 * Prevents multiple simultaneous runs
 */
function runAwsUpdateInBackground() {
  // Check if AWS update is already running
  if (activeAwsUpdateProcesses.size > 0) {
    console.log(
      "[streaming-auth] AWS update script already running, skipping duplicate run",
    );
    return;
  }

  // Check cooldown period - prevent too frequent updates
  const now = Date.now();
  if (lastAwsUpdateTime && now - lastAwsUpdateTime < AWS_UPDATE_COOLDOWN) {
    const minutesRemaining = Math.ceil(
      (AWS_UPDATE_COOLDOWN - (now - lastAwsUpdateTime)) / 60000,
    );
    console.log(
      `[streaming-auth] AWS update cooldown active (${minutesRemaining}min remaining), skipping update`,
    );
    return;
  }

  const awsUpdateScript = path.join(
    __dirname,
    "..",
    "..",
    "scripts",
    "aws",
    "run-aws-update.js",
  );

  if (!fs.existsSync(awsUpdateScript)) {
    console.warn(
      "[streaming-auth] AWS update script not found at:",
      awsUpdateScript,
    );
    console.warn("[streaming-auth] Skipping background update");
    return;
  }

  // Check if AWS_INSTANCE_ID is configured
  if (!process.env.AWS_INSTANCE_ID) {
    console.warn(
      "[streaming-auth] AWS_INSTANCE_ID not configured, skipping AWS update",
    );
    console.warn(
      "[streaming-auth] Set AWS_INSTANCE_ID environment variable to enable automatic updates",
    );
    return;
  }

  // Update the last run time
  lastAwsUpdateTime = now;

  console.log(
    "[streaming-auth] ✅ Starting AWS update script in background...",
  );
  console.log(
    "[streaming-auth]    AWS Instance ID:",
    process.env.AWS_INSTANCE_ID,
  );
  console.log("[streaming-auth]    Script path:", awsUpdateScript);

  // Spawn the AWS update script as a detached process
  const childProcess = spawn("node", [awsUpdateScript], {
    cwd: path.join(__dirname, "..", "..", ".."),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // Detach so it runs independently
    env: {
      ...process.env,
      // Ensure the AWS update script has access to all necessary env vars
    },
  });

  // Track this process
  activeAwsUpdateProcesses.add(childProcess.pid);
  console.log(
    "[streaming-auth]    AWS update process started with PID:",
    childProcess.pid,
  );

  // Unref to allow the parent process to exit independently
  childProcess.unref();

  // Log output for debugging (but don't block)
  childProcess.stdout.on("data", (data) => {
    const output = data.toString().trim();
    console.log(`[aws-update] ${output}`);
  });

  childProcess.stderr.on("data", (data) => {
    const output = data.toString().trim();
    console.error(`[aws-update] ${output}`);
  });

  childProcess.on("exit", (code) => {
    activeAwsUpdateProcesses.delete(childProcess.pid);
    if (code === 0) {
      console.log(
        "[streaming-auth] ✅ AWS update script completed successfully",
      );
    } else {
      console.warn(
        `[streaming-auth] ⚠️  AWS update script exited with code ${code}`,
      );
    }
  });

  childProcess.on("error", (error) => {
    activeAwsUpdateProcesses.delete(childProcess.pid);
    console.error(
      "[streaming-auth] ❌ Failed to start AWS update script:",
      error,
    );
  });
}

// Function to check and store extraction results
function checkAndStoreExtractionResults(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const outputFile = getCookieFilename(normalizedEmail);
  const context = extractionContext.get(normalizedEmail) || "login"; // Default to 'login'

  console.log(
    "[streaming-auth] Checking extraction results for:",
    normalizedEmail,
  );
  console.log("[streaming-auth]    Context:", context);
  console.log("[streaming-auth]    Looking for file:", outputFile);
  console.log("[streaming-auth]    File exists:", fs.existsSync(outputFile));

  if (fs.existsSync(outputFile)) {
    try {
      const cookieData = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      const username = cookieData.username || cookieData.metadata?.username;
      const extractedAt =
        cookieData.metadata?.extractedAt || new Date().toISOString();

      console.log("[streaming-auth]    Cookie data parsed successfully");
      console.log("[streaming-auth]    Username:", username || "not found");
      console.log(
        "[streaming-auth]    Cookies count:",
        cookieData.cookies?.length || 0,
      );

      // Store extraction results even if username is missing (cookies are what matter for auth)
      extractionResults.set(normalizedEmail, {
        username: username || null,
        cookies: cookieData.cookies || [],
        extractedAt,
      });

      if (username) {
        console.log(
          `[streaming-auth] ✅ Stored extraction results for ${normalizedEmail} (with username)`,
        );
      } else {
        console.log(
          `[streaming-auth] ✅ Stored extraction results for ${normalizedEmail} (username not extracted, but cookies are valid)`,
        );
      }

      // Always save cookies to Supabase (regardless of context)
      console.log("[streaming-auth] Saving cookies to Supabase...");
      saveCookiesToSupabase(normalizedEmail, cookieData.cookies)
        .then(() => {
          console.log("[streaming-auth] ✅ Cookies saved to Supabase");

          // Only run AWS update for login context, not for onboarding
          if (context === "login") {
            // Copy cookies to main file for AWS update script compatibility
            console.log(
              "[streaming-auth] Copying cookies to main file for AWS update script...",
            );
            const copied = copyCookiesToMainFile(normalizedEmail);

            if (copied) {
              console.log(
                "[streaming-auth] ✅ Cookies copied to main file, triggering AWS update...",
              );
              if (username) {
                runAwsUpdateInBackground();
              } else {
                console.warn(
                  "[streaming-auth] ⚠️  Username not found, skipping AWS update (but cookies are saved)",
                );
              }
            } else {
              console.error(
                "[streaming-auth] ❌ Failed to copy cookies to main file, AWS update will not run",
              );
            }
          } else {
            console.log(
              "[streaming-auth] ✅ Cookies extracted for onboarding (no AWS update)",
            );
          }
        })
        .catch((error) => {
          console.error(
            "[streaming-auth] ❌ Error saving cookies to Supabase:",
            error,
          );
          // Still try to copy to main file for AWS update even if Supabase save fails
          if (context === "login") {
            const copied = copyCookiesToMainFile(normalizedEmail);
            if (copied && username) {
              runAwsUpdateInBackground();
            }
          }
        });
    } catch (error) {
      console.error(
        "[streaming-auth] ❌ Error parsing extraction results:",
        error,
      );
    }
  } else {
    console.warn(
      "[streaming-auth] ⚠️  Cookie file not found, cannot process extraction results",
    );
  }
}

// Monitor extraction results periodically (fallback)
setInterval(() => {
  // Only check if we have active processes
  if (activeStreamingProcesses.size > 0) {
    for (const [email] of activeStreamingProcesses) {
      if (!extractionResults.has(email.toLowerCase().trim())) {
        checkAndStoreExtractionResults(email);
      }
    }
  }
}, 3000); // Check every 3 seconds

/**
 * GET /api/streaming-auth/update-status
 * Check AWS update status and configuration
 */
router.get("/update-status", async (req, res) => {
  try {
    const mainCookieFile = getMainCookieFile();
    const awsUpdateScript = path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "aws",
      "run-aws-update.js",
    );

    const status = {
      awsConfigured: !!process.env.AWS_INSTANCE_ID,
      awsInstanceId: process.env.AWS_INSTANCE_ID || null,
      scriptExists: fs.existsSync(awsUpdateScript),
      scriptPath: awsUpdateScript,
      cookiesExist: fs.existsSync(mainCookieFile),
      cookieFile: mainCookieFile,
      activeUpdates: activeAwsUpdateProcesses.size,
      ready:
        !!process.env.AWS_INSTANCE_ID &&
        fs.existsSync(awsUpdateScript) &&
        fs.existsSync(mainCookieFile),
    };

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("[streaming-auth] Error checking update status:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check update status",
    });
  }
});

/**
 * POST /api/streaming-auth/trigger-update
 * Manually trigger AWS update script (for testing/debugging)
 */
router.post("/trigger-update", async (req, res) => {
  try {
    console.log("[streaming-auth] Manual AWS update trigger requested");

    // Check if AWS_INSTANCE_ID is configured
    if (!process.env.AWS_INSTANCE_ID) {
      return res.status(400).json({
        success: false,
        error: "AWS_INSTANCE_ID not configured",
      });
    }

    // Check if main cookie file exists
    const mainCookieFile = getMainCookieFile();
    if (!fs.existsSync(mainCookieFile)) {
      return res.status(400).json({
        success: false,
        error: "No cookies found. Please login first.",
        cookieFile: mainCookieFile,
      });
    }

    // Trigger AWS update
    runAwsUpdateInBackground();

    res.json({
      success: true,
      message: "AWS update script triggered in background",
      awsInstanceId: process.env.AWS_INSTANCE_ID,
    });
  } catch (error) {
    console.error("[streaming-auth] Error triggering update:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to trigger update",
    });
  }
});

// =============================================================================
// Device Trust Endpoints (for auto-login security)
// =============================================================================

/**
 * POST /api/streaming-auth/check-device-trust
 * Check if a device is trusted for auto-login
 * A device is trusted if it successfully completed Canvas popup authentication
 * within the last 24 hours on this specific browser/device
 */
router.post("/check-device-trust", async (req, res) => {
  try {
    const { email, device_id, device_hash } = req.body;

    if (!email || !device_id) {
      return res.status(400).json({
        success: false,
        trusted: false,
        error: "Email and device_id are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (findError || !user) {
      console.log(
        `[streaming-auth] Device trust check: user not found for ${normalizedEmail}`,
      );
      return res.json({
        success: true,
        trusted: false,
        reason: "User not found",
      });
    }

    // Query trusted_devices for matching device_id
    const { data: trustedDevice, error: deviceError } = await supabase
      .from("trusted_devices")
      .select("*")
      .eq("user_id", user.id)
      .eq("device_id", device_id)
      .eq("is_active", true)
      .single();

    if (deviceError || !trustedDevice) {
      console.log(
        `[streaming-auth] Device trust check: device not trusted for ${normalizedEmail} (device: ${device_id.substring(0, 8)}...)`,
      );
      return res.json({
        success: true,
        trusted: false,
        reason: "Device not registered",
      });
    }

    // Check if last_login_at is within 24 hours
    const lastLoginAt = new Date(trustedDevice.last_login_at).getTime();
    const now = Date.now();
    const hoursSinceLastLogin = (now - lastLoginAt) / (1000 * 60 * 60);

    if (hoursSinceLastLogin > 24) {
      console.log(
        `[streaming-auth] Device trust check: device trust expired for ${normalizedEmail} (${hoursSinceLastLogin.toFixed(1)} hours old)`,
      );
      return res.json({
        success: true,
        trusted: false,
        reason: "Device trust expired (>24 hours)",
      });
    }

    // Optionally verify device_hash (soft fail - just log if mismatch)
    if (device_hash && trustedDevice.device_hash) {
      if (device_hash !== trustedDevice.device_hash) {
        console.log(
          `[streaming-auth] Device trust check: device hash mismatch for ${normalizedEmail} (browser fingerprint changed)`,
        );
        // Don't fail - hash mismatch can happen with browser updates, etc.
        // Just log it for security monitoring
      }
    }

    console.log(
      `[streaming-auth] Device trust check: device trusted for ${normalizedEmail} (${hoursSinceLastLogin.toFixed(1)} hours since last login)`,
    );
    return res.json({
      success: true,
      trusted: true,
    });
  } catch (error) {
    console.error("[streaming-auth] Error checking device trust:", error);
    // On error, treat as untrusted (user will just see Canvas popup)
    res.json({
      success: false,
      trusted: false,
      error: error.message || "Failed to check device trust",
    });
  }
});

/**
 * POST /api/streaming-auth/trust-device
 * Register a device as trusted after successful Canvas popup authentication
 * Called after the user successfully completes the Canvas login popup
 */
router.post("/trust-device", async (req, res) => {
  try {
    const { email, device_id, device_hash, user_agent } = req.body;

    if (!email || !device_id) {
      return res.status(400).json({
        success: false,
        error: "Email and device_id are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (findError || !user) {
      console.warn(
        `[streaming-auth] Trust device: user not found for ${normalizedEmail}`,
      );
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Upsert trusted device record
    const { error: upsertError } = await supabase
      .from("trusted_devices")
      .upsert(
        {
          user_id: user.id,
          device_id: device_id,
          device_hash: device_hash || null,
          user_agent: user_agent || null,
          last_login_at: new Date().toISOString(),
          is_active: true,
        },
        {
          onConflict: "user_id,device_id",
        },
      );

    if (upsertError) {
      console.error(
        "[streaming-auth] Error upserting trusted device:",
        upsertError,
      );
      return res.status(500).json({
        success: false,
        error: "Failed to register device trust",
      });
    }

    console.log(
      `[streaming-auth] Device trusted for ${normalizedEmail} (device: ${device_id.substring(0, 8)}...)`,
    );
    return res.json({
      success: true,
      message: "Device registered as trusted",
    });
  } catch (error) {
    console.error("[streaming-auth] Error trusting device:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to register device trust",
    });
  }
});

/**
 * POST /api/streaming-auth/revoke-device-trust
 * Revoke trust for a device (e.g., on explicit logout request)
 * This is optional - normal logout doesn't need to revoke device trust
 */
router.post("/revoke-device-trust", async (req, res) => {
  try {
    const { email, device_id } = req.body;

    if (!email || !device_id) {
      return res.status(400).json({
        success: false,
        error: "Email and device_id are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (findError || !user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    // Deactivate the device trust (soft delete)
    const { error: updateError } = await supabase
      .from("trusted_devices")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("device_id", device_id);

    if (updateError) {
      console.error(
        "[streaming-auth] Error revoking device trust:",
        updateError,
      );
      return res.status(500).json({
        success: false,
        error: "Failed to revoke device trust",
      });
    }

    console.log(
      `[streaming-auth] Device trust revoked for ${normalizedEmail} (device: ${device_id.substring(0, 8)}...)`,
    );
    return res.json({
      success: true,
      message: "Device trust revoked",
    });
  } catch (error) {
    console.error("[streaming-auth] Error revoking device trust:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to revoke device trust",
    });
  }
});

module.exports = router;
