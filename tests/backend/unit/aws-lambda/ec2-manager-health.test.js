/**
 * Unit tests for EC2 Manager Health Lambda
 * Tests health checking and instance termination
 */

const assert = require("assert");
const sinon = require("sinon");
const { mockSupabase } = require("../../../shared/mocks/supabase");
const { mockEC2Client } = require("../../../shared/mocks/aws-ec2");

const proxyquire = require("proxyquire").noCallThru();

describe("EC2 Manager Health Lambda", () => {
  let handler;
  let mockStateStore;
  let mockEC2Ops;
  let mockHttps;

  beforeEach(() => {
    mockSupabase.reset();
    mockEC2Client.reset();

    // Create mock state store
    mockStateStore = {
      getInstancesByStatus: sinon.stub(),
      incrementHealthFailures: sinon.stub(),
      resetHealthFailures: sinon.stub(),
      deleteInstance: sinon.stub().resolves(),
      logEvent: sinon.stub().resolves(),
      getSupabase: () => mockSupabase,
    };

    // Create mock EC2 operations
    mockEC2Ops = {
      terminateInstance: sinon.stub().resolves(),
      describeInstance: sinon.stub(),
    };

    // Create mock HTTPS module
    mockHttps = {
      get: sinon.stub(),
    };

    // Load handler with mocked dependencies
    handler = proxyquire("../../../../aws-lambda/ec2-manager-health/index.js", {
      "./shared/state-store": mockStateStore,
      "./shared/ec2-ops": mockEC2Ops,
      "./shared/config": {
        status: {
          WARM: "warm",
          ACTIVE: "active",
          STARTING: "starting",
        },
        requestStatus: {
          ASSIGNED: "assigned",
          IN_PROGRESS: "in_progress",
          FAILED: "failed",
        },
        instances: {
          maxHealthCheckFailures: 3,
        },
        eventTypes: {
          INSTANCE_HEALTH_FAILED: "instance_health_failed",
          INSTANCE_TERMINATED: "instance_terminated",
        },
      },
      https: mockHttps,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("handler", () => {
    it("should check health of all warm/active instances", async () => {
      const instances = [
        {
          instance_id: "i-12345",
          tunnel_url: "https://test1.trycloudflare.com",
          status: "warm",
          health_check_failures: 0,
        },
        {
          instance_id: "i-67890",
          tunnel_url: "https://test2.trycloudflare.com",
          status: "active",
          health_check_failures: 0,
        },
      ];

      mockStateStore.getInstancesByStatus.resolves(instances);

      // Mock successful health checks
      mockHttps.get.callsFake((url, callback) => {
        const mockRes = {
          statusCode: 200,
        };
        setTimeout(() => callback(mockRes), 10);
        return {
          on: sinon.stub(),
        };
      });

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.results.checked, 2);
      assert.strictEqual(body.results.healthy, 2);
    });

    it("should mark unhealthy instance after max failures", async () => {
      const instances = [
        {
          instance_id: "i-12345",
          tunnel_url: "https://test.trycloudflare.com",
          status: "warm",
          health_check_failures: 2, // Already has 2 failures
        },
      ];

      mockStateStore.getInstancesByStatus.resolves(instances);
      mockStateStore.incrementHealthFailures.resolves(3); // This is the 3rd failure

      // Mock failed health check
      mockHttps.get.callsFake((url, callback) => {
        return {
          on: (event, handler) => {
            if (event === "error") {
              setTimeout(() => handler(new Error("Connection refused")), 10);
            }
          },
        };
      });

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.results.terminated, 1);

      // Verify terminate was called
      assert(mockEC2Ops.terminateInstance.calledWith("i-12345"));
      assert(mockStateStore.deleteInstance.calledWith("i-12345"));
    });

    it("should reset health failures on successful check", async () => {
      const instances = [
        {
          instance_id: "i-12345",
          tunnel_url: "https://test.trycloudflare.com",
          status: "warm",
          health_check_failures: 2, // Had previous failures
        },
      ];

      mockStateStore.getInstancesByStatus.resolves(instances);

      // Mock successful health check
      mockHttps.get.callsFake((url, callback) => {
        const mockRes = { statusCode: 200 };
        setTimeout(() => callback(mockRes), 10);
        return { on: sinon.stub() };
      });

      await handler.handler({});

      // Verify reset was called
      assert(mockStateStore.resetHealthFailures.calledWith("i-12345"));
    });

    it("should handle instance without tunnel URL", async () => {
      const instances = [
        {
          instance_id: "i-12345",
          tunnel_url: null, // No tunnel URL
          status: "warm",
          health_check_failures: 2,
        },
      ];

      mockStateStore.getInstancesByStatus.resolves(instances);
      mockStateStore.incrementHealthFailures.resolves(3);

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.results.unhealthy, 1);
    });

    it("should handle no instances", async () => {
      mockStateStore.getInstancesByStatus.resolves([]);

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      const body = JSON.parse(result.body);
      assert.strictEqual(body.results.checked, 0);
    });

    it("should handle errors gracefully", async () => {
      mockStateStore.getInstancesByStatus.rejects(new Error("Database error"));

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 500);
      const body = JSON.parse(result.body);
      assert(body.error.includes("Database error"));
    });
  });
});
