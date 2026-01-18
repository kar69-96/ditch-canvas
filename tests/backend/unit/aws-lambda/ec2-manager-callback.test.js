/**
 * Unit tests for EC2 Manager Callback Lambda
 * Tests instance registration when EC2 instances become ready
 */

const assert = require("assert");
const sinon = require("sinon");
const { mockSupabase } = require("../../../shared/mocks/supabase");

const proxyquire = require("proxyquire").noCallThru();

describe("EC2 Manager Callback Lambda", () => {
  let handler;
  let mockStateStore;

  beforeEach(() => {
    mockSupabase.reset();

    // Create mock state store
    mockStateStore = {
      getInstance: sinon.stub(),
      setInstanceReady: sinon.stub(),
      registerInstance: sinon.stub(),
      logEvent: sinon.stub().resolves(),
    };

    // Load handler with mocked dependencies
    handler = proxyquire(
      "../../../../aws-lambda/ec2-manager-callback/index.js",
      {
        "./shared/state-store": mockStateStore,
        "./shared/config": {
          status: {
            WARM: "warm",
            STARTING: "starting",
          },
          eventTypes: {
            INSTANCE_READY: "instance_ready",
          },
          api: {
            internalApiKey: "test-api-key",
          },
        },
      },
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("handler", () => {
    it("should return 401 if API key is missing", async () => {
      const event = {
        headers: {},
        body: JSON.stringify({
          instanceId: "i-12345",
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 401);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.error, "Unauthorized");
    });

    it("should return 401 if API key is invalid", async () => {
      const event = {
        headers: {
          "x-internal-key": "wrong-key",
        },
        body: JSON.stringify({
          instanceId: "i-12345",
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 401);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.error, "Unauthorized");
    });

    it("should return 400 if instanceId is missing", async () => {
      const event = {
        headers: {
          "x-internal-key": "test-api-key",
        },
        body: JSON.stringify({
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 400);
      const body = JSON.parse(result.body);
      assert(body.error.includes("instanceId"));
    });

    it("should return 400 if tunnelUrl is missing", async () => {
      const event = {
        headers: {
          "x-internal-key": "test-api-key",
        },
        body: JSON.stringify({
          instanceId: "i-12345",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 400);
      const body = JSON.parse(result.body);
      assert(body.error.includes("tunnelUrl"));
    });

    it("should update existing instance to ready state", async () => {
      const existingInstance = {
        instance_id: "i-12345",
        status: "starting",
        tunnel_url: null,
      };

      const updatedInstance = {
        instance_id: "i-12345",
        status: "warm",
        tunnel_url: "https://test.trycloudflare.com",
      };

      mockStateStore.getInstance.resolves(existingInstance);
      mockStateStore.setInstanceReady.resolves(updatedInstance);

      const event = {
        headers: {
          "x-internal-key": "test-api-key",
        },
        body: JSON.stringify({
          instanceId: "i-12345",
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, true);

      // Verify setInstanceReady was called with correct params
      assert(
        mockStateStore.setInstanceReady.calledWith(
          "i-12345",
          "https://test.trycloudflare.com",
        ),
      );
    });

    it("should register new instance if not found", async () => {
      mockStateStore.getInstance.resolves(null); // Instance not found

      const newInstance = {
        instance_id: "i-new12345",
        status: "warm",
        tunnel_url: "https://test.trycloudflare.com",
      };

      mockStateStore.registerInstance.resolves(newInstance);
      mockStateStore.setInstanceReady.resolves(newInstance);

      const event = {
        headers: {
          "x-internal-key": "test-api-key",
        },
        body: JSON.stringify({
          instanceId: "i-new12345",
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, true);

      // Verify registerInstance was called
      assert(mockStateStore.registerInstance.called);
    });

    it("should handle database errors gracefully", async () => {
      mockStateStore.getInstance.rejects(
        new Error("Database connection failed"),
      );

      const event = {
        headers: {
          "x-internal-key": "test-api-key",
        },
        body: JSON.stringify({
          instanceId: "i-12345",
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 500);
      const body = JSON.parse(result.body);
      assert(body.error.includes("Database connection failed"));
    });

    it("should handle case-insensitive header names", async () => {
      const existingInstance = {
        instance_id: "i-12345",
        status: "starting",
      };

      mockStateStore.getInstance.resolves(existingInstance);
      mockStateStore.setInstanceReady.resolves({
        ...existingInstance,
        status: "warm",
        tunnel_url: "https://test.trycloudflare.com",
      });

      const event = {
        headers: {
          "X-Internal-Key": "test-api-key", // Different case
        },
        body: JSON.stringify({
          instanceId: "i-12345",
          tunnelUrl: "https://test.trycloudflare.com",
        }),
      };

      const result = await handler.handler(event);

      // Should still work with different header case
      assert.strictEqual(result.statusCode, 200);
    });
  });
});
