/**
 * Unit tests for EC2 Manager Client
 * Tests the client-side interface for requesting instances
 */

const assert = require("assert");
const sinon = require("sinon");

const proxyquire = require("proxyquire").noCallThru();

describe("EC2 Manager Client", () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    // Create mock fetch
    mockFetch = sinon.stub();

    // Load client with mocked fetch
    client = proxyquire("../../../../src/services/ec2-manager/client.js", {
      "node-fetch": mockFetch,
    });

    // Set environment variable
    process.env.EC2_MANAGER_URL = "https://test-api.amazonaws.com";
    process.env.EC2_MANAGER_ENABLED = "true";
  });

  afterEach(() => {
    sinon.restore();
    delete process.env.EC2_MANAGER_URL;
    delete process.env.EC2_MANAGER_ENABLED;
  });

  describe("requestInstance", () => {
    it("should request instance for email", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            tunnelUrl: "https://test.trycloudflare.com",
            instanceId: "i-12345",
            requestId: "req-123",
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.requestInstance("test@colorado.edu", "login");

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tunnelUrl, "https://test.trycloudflare.com");
      assert.strictEqual(result.instanceId, "i-12345");

      // Verify fetch was called correctly
      assert(mockFetch.calledOnce);
      const [url, options] = mockFetch.firstCall.args;
      assert(url.includes("/api/ec2-manager/assign"));
      assert.strictEqual(options.method, "POST");

      const body = JSON.parse(options.body);
      assert.strictEqual(body.email, "test@colorado.edu");
      assert.strictEqual(body.context, "login");
    });

    it("should handle queued response", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            queued: true,
            requestId: "req-123",
            position: 2,
            estimatedWaitSeconds: 60,
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.requestInstance("test@colorado.edu");

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.queued, true);
      assert.strictEqual(result.position, 2);
    });

    it("should handle API errors", async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: "Internal server error",
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.requestInstance("test@colorado.edu");

      assert.strictEqual(result.success, false);
      assert(result.error);
    });

    it("should handle network errors", async () => {
      mockFetch.rejects(new Error("Network error"));

      const result = await client.requestInstance("test@colorado.edu");

      assert.strictEqual(result.success, false);
      assert(result.error.includes("Network error"));
    });

    it("should return disabled when EC2_MANAGER_ENABLED is false", async () => {
      process.env.EC2_MANAGER_ENABLED = "false";

      const result = await client.requestInstance("test@colorado.edu");

      assert.strictEqual(result.success, false);
      assert(result.disabled);
      assert(!mockFetch.called);
    });
  });

  describe("releaseInstance", () => {
    it("should release instance session", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.releaseInstance("req-123", "completed");

      assert.strictEqual(result.success, true);

      // Verify fetch was called correctly
      const [url, options] = mockFetch.firstCall.args;
      assert(url.includes("/api/ec2-manager/release"));

      const body = JSON.parse(options.body);
      assert.strictEqual(body.requestId, "req-123");
      assert.strictEqual(body.status, "completed");
    });

    it("should handle release failure", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            error: "Request not found",
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.releaseInstance("invalid-req");

      assert.strictEqual(result.success, false);
    });
  });

  describe("getRequestStatus", () => {
    it("should get status of pending request", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            status: "pending",
            position: 3,
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.getRequestStatus("req-123");

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, "pending");
      assert.strictEqual(result.position, 3);
    });

    it("should get status of assigned request", async () => {
      const mockResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            status: "assigned",
            tunnelUrl: "https://test.trycloudflare.com",
            instanceId: "i-12345",
          }),
      };

      mockFetch.resolves(mockResponse);

      const result = await client.getRequestStatus("req-123");

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status, "assigned");
      assert.strictEqual(result.tunnelUrl, "https://test.trycloudflare.com");
    });
  });

  describe("isEnabled", () => {
    it("should return true when enabled", () => {
      process.env.EC2_MANAGER_ENABLED = "true";
      assert.strictEqual(client.isEnabled(), true);
    });

    it("should return false when disabled", () => {
      process.env.EC2_MANAGER_ENABLED = "false";
      assert.strictEqual(client.isEnabled(), false);
    });

    it("should return false when env var missing", () => {
      delete process.env.EC2_MANAGER_ENABLED;
      assert.strictEqual(client.isEnabled(), false);
    });
  });

  describe("getManagerUrl", () => {
    it("should return configured URL", () => {
      process.env.EC2_MANAGER_URL = "https://custom-api.example.com";
      assert.strictEqual(
        client.getManagerUrl(),
        "https://custom-api.example.com",
      );
    });

    it("should return null when not configured", () => {
      delete process.env.EC2_MANAGER_URL;
      assert.strictEqual(client.getManagerUrl(), null);
    });
  });
});
