/**
 * EC2 Manager Client
 *
 * Client for interacting with the EC2 Manager Lambda functions.
 * Used by streaming-auth.js to dynamically assign auth requests to instances.
 */

const https = require("https");
const http = require("http");

// Configuration
const EC2_MANAGER_URL =
  process.env.EC2_MANAGER_URL || "https://api.ditchcanvas.com";
const EC2_MANAGER_ENABLED = process.env.EC2_MANAGER_ENABLED === "true";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

/**
 * Check if EC2 Manager is enabled
 */
function isEnabled() {
  return EC2_MANAGER_ENABLED;
}

/**
 * Make HTTP request to EC2 Manager
 */
function makeRequest(endpoint, method, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, EC2_MANAGER_URL);
    const isHttps = url.protocol === "https:";
    const httpModule = isHttps ? https : http;

    const body = data ? JSON.stringify(data) : null;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        ...(body && { "Content-Length": Buffer.byteLength(body) }),
        ...(INTERNAL_API_KEY && { "X-Internal-Key": INTERNAL_API_KEY }),
      },
      timeout: 30000, // 30 second timeout
    };

    const req = httpModule.request(options, (res) => {
      let responseBody = "";

      res.on("data", (chunk) => {
        responseBody += chunk;
      });

      res.on("end", () => {
        try {
          const parsed = JSON.parse(responseBody);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          }
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

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Request instance assignment for an auth request
 *
 * @param {string} email - User email
 * @param {string} context - 'login' or 'onboarding'
 * @returns {Promise<Object>} Assignment result
 */
async function requestAssignment(email, context = "login") {
  if (!isEnabled()) {
    return { success: false, error: "EC2 Manager not enabled" };
  }

  try {
    console.log(
      `[ec2-manager] Requesting assignment for ${email} (${context})`,
    );

    const result = await makeRequest("/api/ec2-manager/assign", "POST", {
      email,
      context,
    });

    if (result.success && result.tunnelUrl) {
      console.log(`[ec2-manager] Assigned to instance ${result.instanceId}`);
      return {
        success: true,
        tunnelUrl: result.tunnelUrl,
        instanceId: result.instanceId,
        requestId: result.requestId,
      };
    }

    if (result.queued) {
      console.log(
        `[ec2-manager] Request queued at position ${result.position}`,
      );
      return {
        success: false,
        queued: true,
        requestId: result.requestId,
        position: result.position,
        estimatedWaitSeconds: result.estimatedWaitSeconds,
      };
    }

    return { success: false, error: result.error || "Assignment failed" };
  } catch (error) {
    console.error("[ec2-manager] Assignment error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get request status (for polling)
 *
 * @param {string} requestId - Request ID from requestAssignment
 * @returns {Promise<Object>} Request status
 */
async function getRequestStatus(requestId) {
  if (!isEnabled()) {
    return { success: false, error: "EC2 Manager not enabled" };
  }

  try {
    const result = await makeRequest(
      `/api/ec2-manager/status/${requestId}`,
      "GET",
    );
    return result;
  } catch (error) {
    console.error("[ec2-manager] Status check error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Release a session when auth completes
 *
 * @param {string} requestId - Request ID
 * @param {string} status - 'completed' or 'failed'
 * @returns {Promise<Object>} Release result
 */
async function releaseSession(requestId, status = "completed") {
  if (!isEnabled()) {
    return { success: false, error: "EC2 Manager not enabled" };
  }

  try {
    console.log(`[ec2-manager] Releasing session ${requestId} (${status})`);

    const result = await makeRequest("/api/ec2-manager/release", "POST", {
      requestId,
      status,
    });

    return result;
  } catch (error) {
    console.error("[ec2-manager] Release error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get current scaling metrics
 *
 * @returns {Promise<Object>} Metrics
 */
async function getMetrics() {
  if (!isEnabled()) {
    return { success: false, error: "EC2 Manager not enabled" };
  }

  try {
    const result = await makeRequest("/api/ec2-manager/metrics", "GET");
    return result;
  } catch (error) {
    console.error("[ec2-manager] Metrics error:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Manually trigger pre-warming of instances
 *
 * @param {number} count - Number of instances to warm
 * @returns {Promise<Object>} Result
 */
async function prewarmInstances(count = 2) {
  if (!isEnabled()) {
    return { success: false, error: "EC2 Manager not enabled" };
  }

  try {
    console.log(`[ec2-manager] Pre-warming ${count} instances`);

    const result = await makeRequest("/api/ec2-manager/prewarm", "POST", {
      count,
    });

    return result;
  } catch (error) {
    console.error("[ec2-manager] Prewarm error:", error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  isEnabled,
  requestAssignment,
  getRequestStatus,
  releaseSession,
  getMetrics,
  prewarmInstances,
};
