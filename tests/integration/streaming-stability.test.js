/**
 * Integration tests for Streaming Server Stability
 * Tests scale handling and EC2 instance stability
 *
 * These tests verify:
 * 1. The dedicated tunnel (login.ditchcanvas.com) handles concurrent requests
 * 2. Health checks pass consistently (no instance termination)
 * 3. The streaming server remains stable under load
 */

const assert = require("assert");
const https = require("https");
const http = require("http");

// Configuration
const DEDICATED_TUNNEL_URL =
  process.env.DEDICATED_TUNNEL_URL || "https://login.ditchcanvas.com";
const VERCEL_URL = process.env.VERCEL_URL || "https://ditchcanvas.com";
const CONCURRENT_REQUESTS = 10;
const HEALTH_CHECK_INTERVAL_MS = 2000;
const STABILITY_TEST_DURATION_MS = 30000; // 30 seconds

/**
 * Make HTTP/HTTPS request
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const httpModule = parsedUrl.protocol === "https:" ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 15000,
    };

    if (options.body) {
      reqOptions.headers["Content-Type"] = "application/json";
      reqOptions.headers["Content-Length"] = Buffer.byteLength(options.body);
    }

    const req = httpModule.request(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: JSON.parse(body),
          });
        } catch {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body,
          });
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Check streaming server health
 */
async function checkHealth(tunnelUrl = DEDICATED_TUNNEL_URL) {
  const startTime = Date.now();
  try {
    const result = await makeRequest(`${tunnelUrl}/health`, { timeout: 10000 });
    return {
      healthy: result.statusCode === 200 && result.body?.status === "ok",
      responseTime: Date.now() - startTime,
      statusCode: result.statusCode,
      body: result.body,
    };
  } catch (error) {
    return {
      healthy: false,
      responseTime: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Request streaming auth start via Vercel
 */
async function requestStreamingAuth(email) {
  const startTime = Date.now();
  try {
    const result = await makeRequest(`${VERCEL_URL}/api/streaming-auth/start`, {
      method: "POST",
      body: JSON.stringify({ email }),
      timeout: 15000,
    });
    return {
      success: result.statusCode === 200 && result.body?.success === true,
      responseTime: Date.now() - startTime,
      statusCode: result.statusCode,
      body: result.body,
    };
  } catch (error) {
    return {
      success: false,
      responseTime: Date.now() - startTime,
      error: error.message,
    };
  }
}

describe("Streaming Server Stability", function () {
  // Increase timeout for stability tests
  this.timeout(60000);

  // Skip if not in integration test mode
  const describeIntegration = process.env.RUN_INTEGRATION_TESTS
    ? describe
    : describe.skip;

  describeIntegration("Health Check Stability", () => {
    it("should pass health check", async () => {
      const result = await checkHealth();

      assert.strictEqual(
        result.healthy,
        true,
        `Health check failed: ${JSON.stringify(result)}`,
      );
      assert(
        result.responseTime < 5000,
        `Response time too slow: ${result.responseTime}ms`,
      );
    });

    it("should pass multiple consecutive health checks", async () => {
      const results = [];

      for (let i = 0; i < 5; i++) {
        const result = await checkHealth();
        results.push(result);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const allHealthy = results.every((r) => r.healthy);
      const avgResponseTime =
        results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

      assert.strictEqual(
        allHealthy,
        true,
        `Some health checks failed: ${JSON.stringify(results.filter((r) => !r.healthy))}`,
      );
      assert(
        avgResponseTime < 3000,
        `Average response time too slow: ${avgResponseTime}ms`,
      );
    });

    it("should remain healthy over extended period (30 seconds)", async () => {
      const results = [];
      const startTime = Date.now();

      while (Date.now() - startTime < STABILITY_TEST_DURATION_MS) {
        const result = await checkHealth();
        results.push({
          ...result,
          timestamp: Date.now() - startTime,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS),
        );
      }

      const failures = results.filter((r) => !r.healthy);
      const successRate =
        ((results.length - failures.length) / results.length) * 100;

      console.log(
        `  Health check results: ${results.length} checks, ${failures.length} failures (${successRate.toFixed(1)}% success)`,
      );

      if (failures.length > 0) {
        console.log(`  Failures:`, JSON.stringify(failures, null, 2));
      }

      assert.strictEqual(
        failures.length,
        0,
        `${failures.length} health checks failed out of ${results.length}`,
      );
    });
  });

  describeIntegration("Concurrent Request Handling", () => {
    it("should handle concurrent streaming auth requests", async () => {
      const emails = Array.from(
        { length: CONCURRENT_REQUESTS },
        (_, i) => `test-user-${i}@example.com`,
      );

      // Send all requests concurrently
      const startTime = Date.now();
      const results = await Promise.all(
        emails.map((email) => requestStreamingAuth(email)),
      );
      const totalTime = Date.now() - startTime;

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      const avgResponseTime =
        results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;

      console.log(`  Concurrent requests: ${CONCURRENT_REQUESTS}`);
      console.log(
        `  Successes: ${successes.length}, Failures: ${failures.length}`,
      );
      console.log(
        `  Total time: ${totalTime}ms, Avg response: ${avgResponseTime.toFixed(0)}ms`,
      );

      if (failures.length > 0) {
        console.log(
          `  Failure details:`,
          JSON.stringify(failures.slice(0, 3), null, 2),
        );
      }

      // All requests should succeed
      assert.strictEqual(
        successes.length,
        CONCURRENT_REQUESTS,
        `Only ${successes.length}/${CONCURRENT_REQUESTS} requests succeeded`,
      );

      // Response time should be reasonable
      assert(
        avgResponseTime < 10000,
        `Average response time too slow: ${avgResponseTime}ms`,
      );
    });

    it("should return correct streaming URL for all requests", async () => {
      const emails = Array.from(
        { length: 5 },
        (_, i) => `url-test-${i}@example.com`,
      );

      const results = await Promise.all(
        emails.map((email) => requestStreamingAuth(email)),
      );

      for (const result of results) {
        assert.strictEqual(
          result.success,
          true,
          `Request failed: ${JSON.stringify(result)}`,
        );
        assert(result.body.url, "Missing URL in response");
        assert(
          result.body.url.includes("login.ditchcanvas.com"),
          `URL should use dedicated tunnel: ${result.body.url}`,
        );
      }
    });

    it("should maintain health after concurrent requests", async () => {
      // Check health before
      const healthBefore = await checkHealth();
      assert.strictEqual(
        healthBefore.healthy,
        true,
        "Health check failed before test",
      );

      // Send concurrent requests
      const emails = Array.from(
        { length: CONCURRENT_REQUESTS },
        (_, i) => `load-test-${i}@example.com`,
      );
      await Promise.all(emails.map((email) => requestStreamingAuth(email)));

      // Wait a moment for any side effects
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check health after
      const healthAfter = await checkHealth();
      assert.strictEqual(
        healthAfter.healthy,
        true,
        `Health check failed after concurrent requests: ${JSON.stringify(healthAfter)}`,
      );
    });
  });

  describeIntegration("EC2 Instance Stability", () => {
    it("should not show capacity errors for single user", async () => {
      const result = await requestStreamingAuth("single-user@example.com");

      assert.strictEqual(
        result.success,
        true,
        `Request failed: ${JSON.stringify(result)}`,
      );
      assert(
        !result.body.error?.includes("capacity"),
        `Should not show capacity error: ${result.body.error}`,
      );
    });

    it("should use dedicated tunnel URL, not EC2 Manager", async () => {
      const result = await requestStreamingAuth("tunnel-check@example.com");

      assert.strictEqual(
        result.success,
        true,
        `Request failed: ${JSON.stringify(result)}`,
      );

      // Should NOT have EC2 Manager fields
      assert(
        !result.body.instanceId,
        "Should not have instanceId (EC2 Manager disabled)",
      );
      assert(
        !result.body.requestId,
        "Should not have requestId (EC2 Manager disabled)",
      );
      assert(
        !result.body.queued,
        "Should not be queued (EC2 Manager disabled)",
      );

      // Should have dedicated tunnel URL
      assert(
        result.body.streamingServerUrl === "https://login.ditchcanvas.com" ||
          result.body.streamingServerUrl?.includes("login.ditchcanvas.com"),
        `Should use dedicated tunnel: ${result.body.streamingServerUrl}`,
      );
    });

    it("should remain stable after repeated requests", async () => {
      const iterations = 20;
      const results = [];

      for (let i = 0; i < iterations; i++) {
        const result = await requestStreamingAuth(`stability-${i}@example.com`);
        results.push(result);

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const failures = results.filter((r) => !r.success);

      console.log(`  Repeated requests: ${iterations} iterations`);
      console.log(
        `  Successes: ${results.length - failures.length}, Failures: ${failures.length}`,
      );

      // All requests should succeed
      assert.strictEqual(
        failures.length,
        0,
        `${failures.length} requests failed: ${JSON.stringify(failures.slice(0, 3))}`,
      );
    });

    it("should pass health check after stability test", async () => {
      // Final health check to ensure instance is still up
      const result = await checkHealth();

      assert.strictEqual(
        result.healthy,
        true,
        `Final health check failed: ${JSON.stringify(result)}`,
      );

      console.log(`  Final health check: OK (${result.responseTime}ms)`);
    });
  });
});

// Export for programmatic use
module.exports = {
  checkHealth,
  requestStreamingAuth,
  makeRequest,
  DEDICATED_TUNNEL_URL,
  VERCEL_URL,
};
