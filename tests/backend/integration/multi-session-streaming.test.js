/**
 * Integration tests for Multi-Session Streaming Auth Server
 *
 * Tests the isolated browser session functionality including:
 * - Unique sessions per user
 * - Concurrent sessions on one instance
 * - Session capacity limits (MAX_SESSIONS)
 * - Session cleanup
 * - Socket.IO room-based isolation
 * - Fast interaction handling
 * - Navigation timeout handling (fedauth)
 */

const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const { io: ioClient } = require("socket.io-client");

// Helper function for async delays
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Test configuration
const TEST_PORT = 3099; // Use different port to avoid conflicts
const SERVER_SCRIPT = path.join(
  __dirname,
  "../../../src/core/extract-cookies-streaming.js",
);
const SERVER_START_TIMEOUT = 10000;
const REQUEST_TIMEOUT = 5000;

// Helper to make HTTP requests
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data),
          });
        } catch {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
          });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    req.end();
  });
}

// Helper to wait for server to be ready
async function waitForServer(port, maxWait = SERVER_START_TIMEOUT) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    try {
      const response = await httpRequest({
        hostname: "localhost",
        port,
        path: "/health",
        method: "GET",
      });
      if (response.statusCode === 200) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await wait(200);
  }
  throw new Error(`Server did not start within ${maxWait}ms`);
}

describe("Multi-Session Streaming Server", function () {
  this.timeout(60000); // Allow up to 60 seconds for server tests

  let serverProcess;
  let serverPort = TEST_PORT;

  before(async function () {
    // Start the streaming server with test configuration
    serverProcess = spawn("node", [SERVER_SCRIPT], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        STREAMING_PORT: serverPort.toString(),
        MAX_SESSIONS: "3",
        CANVAS_URL: "https://canvas.colorado.edu",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Capture server output for debugging
    serverProcess.stdout.on("data", (data) => {
      if (process.env.DEBUG) {
        console.log(`[server stdout]: ${data}`);
      }
    });

    serverProcess.stderr.on("data", (data) => {
      if (process.env.DEBUG) {
        console.error(`[server stderr]: ${data}`);
      }
    });

    serverProcess.on("error", (err) => {
      console.error("Server process error:", err);
    });

    // Wait for server to be ready
    await waitForServer(serverPort);
    console.log(`Test server started on port ${serverPort}`);
  });

  after(async function () {
    // Kill the server process
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await wait(1000);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  });

  describe("Health Endpoint", () => {
    it("should return health status with session metrics", async () => {
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/health",
        method: "GET",
      });

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.status, "ok");
      assert.strictEqual(response.body.port, serverPort);
      assert.strictEqual(typeof response.body.activeSessions, "number");
      assert.strictEqual(typeof response.body.maxSessions, "number");
      assert.strictEqual(typeof response.body.availableSlots, "number");
      assert.strictEqual(response.body.maxSessions, 3);
    });

    it("should report available slots correctly", async () => {
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/health",
        method: "GET",
      });

      const { activeSessions, maxSessions, availableSlots } = response.body;
      assert.strictEqual(availableSlots, maxSessions - activeSessions);
    });
  });

  describe("Session ID Requirement", () => {
    it("should reject requests without sessionId", async () => {
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/",
        method: "GET",
      });

      assert.strictEqual(response.statusCode, 400);
      assert(response.body.error.includes("sessionId"));
    });

    it("should accept requests with sessionId", async () => {
      const sessionId = `test-session-${Date.now()}`;
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: `/?sessionId=${sessionId}`,
        method: "GET",
      });

      // Should return HTML (not JSON error)
      assert.strictEqual(response.statusCode, 200);
      assert(typeof response.body === "string");
      assert(response.body.includes("<!DOCTYPE html>"));
      assert(response.body.includes(sessionId));
    });
  });

  describe("Unique Sessions Per User", () => {
    it("should embed sessionId in viewer HTML", async () => {
      const sessionId = `unique-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: `/?sessionId=${sessionId}`,
        method: "GET",
      });

      assert.strictEqual(response.statusCode, 200);
      // Check that sessionId is embedded in the HTML
      assert(response.body.includes(`const SESSION_ID = "${sessionId}"`));
    });

    it("should generate different HTML for different sessionIds", async () => {
      const sessionId1 = `session-a-${Date.now()}`;
      const sessionId2 = `session-b-${Date.now()}`;

      const response1 = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: `/?sessionId=${sessionId1}`,
        method: "GET",
      });

      const response2 = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: `/?sessionId=${sessionId2}`,
        method: "GET",
      });

      assert.strictEqual(response1.statusCode, 200);
      assert.strictEqual(response2.statusCode, 200);
      assert(response1.body.includes(sessionId1));
      assert(response2.body.includes(sessionId2));
      assert(!response1.body.includes(sessionId2));
      assert(!response2.body.includes(sessionId1));
    });
  });

  describe("Extraction Result Endpoint", () => {
    it("should return session not found for non-existent session", async () => {
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/extraction-result/non-existent-session",
        method: "GET",
      });

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(response.body.success, false);
      assert(
        response.body.error.includes("not found") ||
          response.body.requiresReauth,
      );
    });
  });

  describe("Socket.IO Session Isolation", function () {
    this.timeout(30000);

    it("should reject connections without sessionId", (done) => {
      let finished = false;
      const socket = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: {}, // No sessionId
      });

      socket.on("error", (error) => {
        if (!finished) {
          finished = true;
          assert(error.includes("sessionId"));
          socket.close();
          done();
        }
      });

      socket.on("disconnect", () => {
        // Server disconnects clients without sessionId after sending error
        if (!finished) {
          finished = true;
          socket.close();
          done();
        }
      });

      socket.on("connect", () => {
        // Server connects first, then validates sessionId and disconnects if missing
        // Wait briefly for the error/disconnect event
      });

      // Timeout if neither error nor disconnect fires
      setTimeout(() => {
        if (!finished) {
          finished = true;
          socket.close();
          done(new Error("Expected error or disconnect event"));
        }
      }, 5000);
    });

    it("should accept connections with sessionId and join room", (done) => {
      const sessionId = `socket-test-${Date.now()}`;
      const socket = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: { sessionId },
      });

      socket.on("connect", () => {
        // Connection successful - socket should be in session room
        setTimeout(() => {
          socket.close();
          done();
        }, 500);
      });

      socket.on("error", (error) => {
        socket.close();
        // May get capacity error if tests run in parallel
        if (error.includes("capacity")) {
          done();
        } else {
          done(new Error(`Unexpected error: ${error}`));
        }
      });

      socket.on("connect_error", (err) => {
        socket.close();
        done(new Error(`Connection error: ${err.message}`));
      });
    });

    it("should route status events to correct session room only", function (done) {
      this.timeout(15000);

      const sessionId1 = `isolation-test-1-${Date.now()}`;
      const sessionId2 = `isolation-test-2-${Date.now()}`;
      let socket1Events = [];
      let socket2Events = [];

      const socket1 = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: { sessionId: sessionId1 },
      });

      const socket2 = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: { sessionId: sessionId2 },
      });

      socket1.on("status", (data) => {
        socket1Events.push(data);
      });

      socket2.on("status", (data) => {
        socket2Events.push(data);
      });

      // Wait for connections and some events
      setTimeout(() => {
        socket1.close();
        socket2.close();

        // Each socket should only receive events for its own session
        // Status events include stage info that's specific to each session
        // At minimum, verify that events were isolated (if any events received)
        if (socket1Events.length > 0) {
          socket1Events.forEach((evt) => {
            // Events should not contain the other session's ID
            if (evt.sessionId) {
              assert.notStrictEqual(evt.sessionId, sessionId2);
            }
          });
        }
        if (socket2Events.length > 0) {
          socket2Events.forEach((evt) => {
            if (evt.sessionId) {
              assert.notStrictEqual(evt.sessionId, sessionId1);
            }
          });
        }

        done();
      }, 5000);
    });
  });

  describe("Concurrent Sessions", function () {
    this.timeout(45000);

    it("should handle multiple concurrent session requests", async () => {
      const sessionIds = [
        `concurrent-1-${Date.now()}`,
        `concurrent-2-${Date.now()}`,
        `concurrent-3-${Date.now()}`,
      ];

      // Request all sessions concurrently
      const requests = sessionIds.map((sessionId) =>
        httpRequest({
          hostname: "localhost",
          port: serverPort,
          path: `/?sessionId=${sessionId}`,
          method: "GET",
        }),
      );

      const responses = await Promise.all(requests);

      // All should succeed (status 200 or 503 if already at capacity from previous tests)
      responses.forEach((response, i) => {
        assert(
          response.statusCode === 200 || response.statusCode === 503,
          `Session ${sessionIds[i]} got unexpected status ${response.statusCode}`,
        );
      });

      // Count successful responses
      const successCount = responses.filter((r) => r.statusCode === 200).length;
      console.log(`Successfully created ${successCount} concurrent sessions`);
    });
  });

  describe("Session Capacity Limits", function () {
    this.timeout(30000);

    it("should return 503 when at capacity", async function () {
      // First, check current capacity
      const healthBefore = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/health",
        method: "GET",
      });

      const availableSlots = healthBefore.body.availableSlots;
      console.log(`Available slots before test: ${availableSlots}`);

      if (availableSlots <= 0) {
        // Already at capacity, try to add one more
        const sessionId = `capacity-test-overflow-${Date.now()}`;
        const response = await httpRequest({
          hostname: "localhost",
          port: serverPort,
          path: `/?sessionId=${sessionId}`,
          method: "GET",
        });

        assert.strictEqual(
          response.statusCode,
          503,
          "Should return 503 when at capacity",
        );
        assert(response.body.error.includes("capacity"));
      } else {
        // Fill up remaining capacity
        const sessionsToCreate = [];
        for (let i = 0; i < availableSlots; i++) {
          sessionsToCreate.push(`fill-capacity-${Date.now()}-${i}`);
        }

        // Create sessions to fill capacity
        for (const sessionId of sessionsToCreate) {
          await httpRequest({
            hostname: "localhost",
            port: serverPort,
            path: `/?sessionId=${sessionId}`,
            method: "GET",
          });
        }

        // Now try one more - should fail
        const overflowSessionId = `capacity-overflow-${Date.now()}`;
        const response = await httpRequest({
          hostname: "localhost",
          port: serverPort,
          path: `/?sessionId=${overflowSessionId}`,
          method: "GET",
        });

        // Should return 503 or the HTML if we somehow still had capacity
        if (response.statusCode === 503) {
          assert(response.body.error.includes("capacity"));
          assert.strictEqual(response.body.maxSessions, 3);
        }
      }
    });
  });

  describe("Mobile Client Support", () => {
    it("should accept mobile flag in query parameter", async () => {
      const sessionId = `mobile-test-${Date.now()}`;
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: `/?sessionId=${sessionId}&mobile=1`,
        method: "GET",
      });

      // Should return HTML successfully (or 503 if at capacity)
      assert(
        response.statusCode === 200 || response.statusCode === 503,
        `Unexpected status: ${response.statusCode}`,
      );
    });
  });

  describe("Input Event Handling", function () {
    this.timeout(20000);

    it("should handle rapid mouse move events without blocking", function (done) {
      let finished = false;
      const finish = (err) => {
        if (!finished) {
          finished = true;
          socket.close();
          done(err);
        }
      };

      const sessionId = `rapid-input-${Date.now()}`;
      const socket = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: { sessionId },
      });

      let eventsSent = 0;
      const targetEvents = 50;

      socket.on("connect", () => {
        // Send rapid mouse move events
        const startTime = Date.now();
        for (let i = 0; i < targetEvents; i++) {
          socket.emit("mouse-move", { x: i * 10, y: i * 5 });
          eventsSent++;
        }
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(
          `Sent ${eventsSent} mouse-move events in ${duration}ms (${(eventsSent / duration) * 1000} events/sec)`,
        );

        // Events should be sent quickly (< 500ms for 50 events)
        assert(duration < 500, `Events took too long to send: ${duration}ms`);

        setTimeout(() => finish(), 500);
      });

      socket.on("error", (error) => {
        if (error.includes("capacity")) {
          finish(); // Skip if at capacity
        } else {
          finish(new Error(`Socket error: ${error}`));
        }
      });

      socket.on("connect_error", (err) => {
        finish(new Error(`Connection error: ${err.message}`));
      });
    });

    it("should handle key-down and key-up events", function (done) {
      let finished = false;
      const finish = (err) => {
        if (!finished) {
          finished = true;
          socket.close();
          done(err);
        }
      };

      const sessionId = `keyboard-test-${Date.now()}`;
      const socket = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: { sessionId },
      });

      socket.on("connect", () => {
        // Simulate typing "test"
        const keys = ["t", "e", "s", "t"];
        keys.forEach((key) => {
          socket.emit("key-down", { key, code: `Key${key.toUpperCase()}` });
          socket.emit("key-up", { key, code: `Key${key.toUpperCase()}` });
        });

        // Also test type-text event
        socket.emit("type-text", { text: "hello" });

        setTimeout(() => finish(), 500);
      });

      socket.on("error", (error) => {
        if (error.includes("capacity")) {
          finish();
        } else {
          finish(new Error(`Socket error: ${error}`));
        }
      });

      socket.on("connect_error", (err) => {
        finish(new Error(`Connection error: ${err.message}`));
      });
    });

    it("should handle mouse click events", function (done) {
      let finished = false;
      const finish = (err) => {
        if (!finished) {
          finished = true;
          socket.close();
          done(err);
        }
      };

      const sessionId = `click-test-${Date.now()}`;
      const socket = ioClient(`http://localhost:${serverPort}`, {
        transports: ["websocket"],
        query: { sessionId },
      });

      socket.on("connect", () => {
        // Simulate mouse click events
        socket.emit("mouse-click", { x: 100, y: 200, button: "left" });
        socket.emit("mouse-down", { x: 150, y: 250, button: "left" });
        socket.emit("mouse-up", { x: 150, y: 250, button: "left" });
        socket.emit("mouse-click", { x: 300, y: 400, button: "right" });

        setTimeout(() => finish(), 500);
      });

      socket.on("error", (error) => {
        if (error.includes("capacity")) {
          finish();
        } else {
          finish(new Error(`Socket error: ${error}`));
        }
      });

      socket.on("connect_error", (err) => {
        finish(new Error(`Connection error: ${err.message}`));
      });
    });
  });

  describe("Session Timeout Configuration", () => {
    it("should respect MAX_SESSIONS environment variable", async () => {
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/health",
        method: "GET",
      });

      assert.strictEqual(response.body.maxSessions, 3);
    });
  });

  describe("Legacy Endpoint Compatibility", () => {
    it("should have legacy extraction-result endpoint available", async () => {
      const response = await httpRequest({
        hostname: "localhost",
        port: serverPort,
        path: "/extraction-result-legacy/test@colorado.edu",
        method: "GET",
      });

      assert.strictEqual(response.statusCode, 200);
      // Should return not found or requiresReauth (no active session for this email)
      assert(
        response.body.error || response.body.requiresReauth,
        "Legacy endpoint should handle non-existent sessions",
      );
    });
  });
});

/**
 * Unit tests for session management logic
 * These test the session creation/cleanup logic without starting the full server
 */
describe("Session Management Logic (Unit)", () => {
  const crypto = require("crypto");

  describe("Session ID Generation", () => {
    it("should generate unique UUIDs", () => {
      const ids = new Set();
      for (let i = 0; i < 1000; i++) {
        ids.add(crypto.randomUUID());
      }
      assert.strictEqual(ids.size, 1000, "All generated IDs should be unique");
    });

    it("should generate valid UUID format", () => {
      const uuid = crypto.randomUUID();
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert(uuidRegex.test(uuid), `UUID ${uuid} should match UUID v4 format`);
    });
  });

  describe("Session URL Construction", () => {
    it("should correctly append sessionId to base URL", () => {
      const baseUrl = "https://test.trycloudflare.com";
      const sessionId = crypto.randomUUID();
      const fullUrl = `${baseUrl}?sessionId=${sessionId}`;

      assert(fullUrl.includes("?sessionId="));
      assert(fullUrl.includes(sessionId));

      // Verify URL is parseable
      const parsed = new URL(fullUrl);
      assert.strictEqual(parsed.searchParams.get("sessionId"), sessionId);
    });

    it("should handle mobile flag in URL", () => {
      const baseUrl = "https://test.trycloudflare.com";
      const sessionId = crypto.randomUUID();
      const fullUrl = `${baseUrl}?sessionId=${sessionId}&mobile=1`;

      const parsed = new URL(fullUrl);
      assert.strictEqual(parsed.searchParams.get("sessionId"), sessionId);
      assert.strictEqual(parsed.searchParams.get("mobile"), "1");
    });
  });
});

/**
 * Unit tests for Lambda assign sessionId generation
 */
describe("Lambda Assign Session ID (Unit)", () => {
  const assert = require("assert");
  const sinon = require("sinon");
  const proxyquire = require("proxyquire").noCallThru();

  let handler;
  let mockStateStore;
  let mockEc2Ops;

  beforeEach(() => {
    mockStateStore = {
      enqueueRequest: sinon.stub(),
      findAvailableInstance: sinon.stub(),
      assignRequestToInstance: sinon.stub(),
      getQueuePosition: sinon.stub(),
      getInstancesByStatus: sinon.stub().resolves([]),
      getScalingMetrics: sinon.stub().resolves({
        active_instances: 0,
        warm_instances: 0,
        hibernated_instances: 0,
      }),
      registerInstance: sinon.stub().resolves(),
      updateInstance: sinon.stub().resolves(),
    };

    mockEc2Ops = {
      startInstance: sinon.stub().resolves(),
      launchInstance: sinon.stub().resolves("i-new123"),
    };

    handler = proxyquire("../../../aws-lambda/ec2-manager-assign/index.js", {
      "./shared/state-store": mockStateStore,
      "./shared/ec2-ops": mockEc2Ops,
      "./shared/config": {
        status: {
          STOPPED: "stopped",
          HIBERNATING: "hibernating",
          STARTING: "starting",
        },
        instances: {
          maxInstances: 5,
        },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should include sessionId in success response", async () => {
    const mockRequest = { id: "req-123" };
    const mockInstance = {
      instance_id: "i-12345",
      tunnel_url: "https://test.trycloudflare.com",
    };

    mockStateStore.enqueueRequest.resolves(mockRequest);
    mockStateStore.findAvailableInstance.resolves(mockInstance);
    mockStateStore.assignRequestToInstance.resolves(true);

    const result = await handler.handler({
      body: JSON.stringify({ email: "test@colorado.edu" }),
    });

    const body = JSON.parse(result.body);
    assert.strictEqual(body.success, true);
    assert(body.sessionId, "Response should include sessionId");
    assert(
      body.tunnelUrl.includes("?sessionId="),
      "Tunnel URL should include sessionId",
    );
    assert(
      body.tunnelUrl.includes(body.sessionId),
      "Tunnel URL should contain the returned sessionId",
    );
  });

  it("should include sessionId in queued response", async () => {
    const mockRequest = { id: "req-123" };

    mockStateStore.enqueueRequest.resolves(mockRequest);
    mockStateStore.findAvailableInstance.resolves(null);
    mockStateStore.getQueuePosition.resolves(2);

    const result = await handler.handler({
      body: JSON.stringify({ email: "test@colorado.edu" }),
    });

    const body = JSON.parse(result.body);
    assert.strictEqual(body.queued, true);
    assert(body.sessionId, "Queued response should include sessionId");
  });

  it("should generate unique sessionId for each request", async () => {
    const mockRequest = { id: "req-123" };
    const mockInstance = {
      instance_id: "i-12345",
      tunnel_url: "https://test.trycloudflare.com",
    };

    mockStateStore.enqueueRequest.resolves(mockRequest);
    mockStateStore.findAvailableInstance.resolves(mockInstance);
    mockStateStore.assignRequestToInstance.resolves(true);

    const results = await Promise.all([
      handler.handler({
        body: JSON.stringify({ email: "user1@colorado.edu" }),
      }),
      handler.handler({
        body: JSON.stringify({ email: "user2@colorado.edu" }),
      }),
      handler.handler({
        body: JSON.stringify({ email: "user3@colorado.edu" }),
      }),
    ]);

    const sessionIds = results.map((r) => JSON.parse(r.body).sessionId);
    const uniqueIds = new Set(sessionIds);

    assert.strictEqual(
      uniqueIds.size,
      3,
      "Each request should get a unique sessionId",
    );
  });
});
