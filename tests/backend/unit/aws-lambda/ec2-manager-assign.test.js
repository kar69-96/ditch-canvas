/**
 * Unit tests for EC2 Manager Assign Lambda
 * Tests request assignment to instances
 */

const assert = require("assert");
const sinon = require("sinon");
const { mockSupabase } = require("../../../shared/mocks/supabase");

// Mock the Supabase module before requiring the handler
const proxyquire = require("proxyquire").noCallThru();

describe("EC2 Manager Assign Lambda", () => {
  let handler;
  let mockStateStore;

  beforeEach(() => {
    mockSupabase.reset();

    // Create mock state store
    mockStateStore = {
      enqueueRequest: sinon.stub(),
      findAvailableInstance: sinon.stub(),
      assignRequestToInstance: sinon.stub(),
      getQueuePosition: sinon.stub(),
      getRequest: sinon.stub(),
      logEvent: sinon.stub().resolves(),
    };

    // Load handler with mocked dependencies
    handler = proxyquire("../../../../aws-lambda/ec2-manager-assign/index.js", {
      "./shared/state-store": mockStateStore,
      "./shared/config": {
        requestStatus: {
          PENDING: "pending",
          ASSIGNED: "assigned",
        },
        eventTypes: {
          SESSION_ASSIGNED: "session_assigned",
        },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("handler", () => {
    it("should return 400 if email is missing", async () => {
      const event = {
        body: JSON.stringify({}),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 400);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, false);
      assert(body.error.includes("email"));
    });

    it("should assign request to available instance", async () => {
      const mockRequest = {
        id: "req-123",
        email: "test@colorado.edu",
        status: "pending",
      };

      const mockInstance = {
        instance_id: "i-12345",
        tunnel_url: "https://test.trycloudflare.com",
        status: "warm",
        current_sessions: 0,
        max_sessions: 3,
      };

      mockStateStore.enqueueRequest.resolves(mockRequest);
      mockStateStore.findAvailableInstance.resolves(mockInstance);
      mockStateStore.assignRequestToInstance.resolves(true);

      const event = {
        body: JSON.stringify({
          email: "test@colorado.edu",
          context: "login",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.tunnelUrl, mockInstance.tunnel_url);
      assert.strictEqual(body.instanceId, mockInstance.instance_id);
    });

    it("should queue request when no instance available", async () => {
      const mockRequest = {
        id: "req-123",
        email: "test@colorado.edu",
        status: "pending",
      };

      mockStateStore.enqueueRequest.resolves(mockRequest);
      mockStateStore.findAvailableInstance.resolves(null);
      mockStateStore.getQueuePosition.resolves(2);

      const event = {
        body: JSON.stringify({
          email: "test@colorado.edu",
          context: "login",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.queued, true);
      assert.strictEqual(body.position, 2);
    });

    it("should handle assignment failure gracefully", async () => {
      const mockRequest = {
        id: "req-123",
        email: "test@colorado.edu",
        status: "pending",
      };

      const mockInstance = {
        instance_id: "i-12345",
        tunnel_url: "https://test.trycloudflare.com",
        status: "warm",
        current_sessions: 3, // Full capacity
        max_sessions: 3,
      };

      mockStateStore.enqueueRequest.resolves(mockRequest);
      mockStateStore.findAvailableInstance.resolves(mockInstance);
      mockStateStore.assignRequestToInstance.resolves(false); // Assignment failed
      mockStateStore.getQueuePosition.resolves(1);

      const event = {
        body: JSON.stringify({
          email: "test@colorado.edu",
          context: "login",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.queued, true);
    });

    it("should handle errors gracefully", async () => {
      mockStateStore.enqueueRequest.rejects(new Error("Database error"));

      const event = {
        body: JSON.stringify({
          email: "test@colorado.edu",
        }),
      };

      const result = await handler.handler(event);

      assert.strictEqual(result.statusCode, 500);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, false);
      assert(body.error.includes("Database error"));
    });
  });
});
