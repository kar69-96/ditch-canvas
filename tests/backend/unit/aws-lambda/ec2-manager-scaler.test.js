/**
 * Unit tests for EC2 Manager Scaler Lambda
 * Tests auto-scaling logic for instance pool management
 */

const assert = require("assert");
const sinon = require("sinon");
const { mockSupabase } = require("../../../shared/mocks/supabase");
const { mockEC2Client } = require("../../../shared/mocks/aws-ec2");

const proxyquire = require("proxyquire").noCallThru();

describe("EC2 Manager Scaler Lambda", () => {
  let handler;
  let mockStateStore;
  let mockEC2Ops;

  beforeEach(() => {
    mockSupabase.reset();
    mockEC2Client.reset();

    // Create mock state store
    mockStateStore = {
      getScalingMetrics: sinon.stub(),
      getInstancesByStatus: sinon.stub(),
      getIdleInstances: sinon.stub(),
      getPendingCount: sinon.stub(),
      registerInstance: sinon.stub(),
      setInstanceHibernating: sinon.stub(),
      deleteInstance: sinon.stub().resolves(),
      logEvent: sinon.stub().resolves(),
    };

    // Create mock EC2 operations
    mockEC2Ops = {
      launchInstance: sinon.stub(),
      startInstance: sinon.stub().resolves(),
      stopInstance: sinon.stub().resolves(),
      terminateInstance: sinon.stub().resolves(),
      describeManagedInstances: sinon.stub(),
      waitForInstanceRunning: sinon.stub().resolves(true),
    };

    // Load handler with mocked dependencies
    handler = proxyquire("../../../../aws-lambda/ec2-manager-scaler/index.js", {
      "./shared/state-store": mockStateStore,
      "./shared/ec2-ops": mockEC2Ops,
      "./shared/config": {
        status: {
          WARM: "warm",
          ACTIVE: "active",
          STARTING: "starting",
          STOPPED: "stopped",
          HIBERNATING: "hibernating",
        },
        instances: {
          minWarmInstances: 1,
          maxInstances: 3,
          maxSessionsPerInstance: 3,
          idleTimeoutMs: 5 * 60 * 1000,
        },
        burst: {
          scaleThreshold: 2,
          scaleCount: 1,
        },
        eventTypes: {
          SCALE_UP: "scale_up",
          SCALE_DOWN: "scale_down",
          INSTANCE_STARTING: "instance_starting",
          INSTANCE_HIBERNATING: "instance_hibernating",
        },
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("handler", () => {
    it("should maintain minimum warm instances", async () => {
      const metrics = {
        pending_requests: 0,
        active_instances: 0,
        warm_instances: 0, // No warm instances
        hibernated_instances: 0,
        total_capacity: 0,
        used_capacity: 0,
      };

      mockStateStore.getScalingMetrics.resolves(metrics);
      mockStateStore.getInstancesByStatus.resolves([]);
      mockStateStore.getIdleInstances.resolves([]);
      mockEC2Ops.describeManagedInstances.resolves([]);
      mockEC2Ops.launchInstance.resolves("i-new12345");
      mockStateStore.registerInstance.resolves({
        instance_id: "i-new12345",
      });

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      // Should launch a new instance to meet minimum
      assert(mockEC2Ops.launchInstance.called);
      assert(mockStateStore.registerInstance.called);
    });

    it("should scale up when pending requests exceed threshold", async () => {
      const metrics = {
        pending_requests: 3, // Exceeds threshold of 2
        active_instances: 1,
        warm_instances: 0,
        hibernated_instances: 0,
        total_capacity: 3,
        used_capacity: 3, // All capacity used
      };

      mockStateStore.getScalingMetrics.resolves(metrics);
      mockStateStore.getInstancesByStatus.resolves([]);
      mockStateStore.getIdleInstances.resolves([]);
      mockEC2Ops.describeManagedInstances.resolves([]);
      mockEC2Ops.launchInstance.resolves("i-burst12345");
      mockStateStore.registerInstance.resolves({
        instance_id: "i-burst12345",
      });

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      assert(mockEC2Ops.launchInstance.called);
    });

    it("should wake hibernated instance instead of launching new", async () => {
      const metrics = {
        pending_requests: 2,
        active_instances: 1,
        warm_instances: 0,
        hibernated_instances: 1, // Has hibernated instance
        total_capacity: 3,
        used_capacity: 3,
      };

      const hibernatedInstance = {
        instance_id: "i-hibernated",
        status: "stopped",
      };

      mockStateStore.getScalingMetrics.resolves(metrics);
      mockStateStore.getInstancesByStatus
        .withArgs(["stopped"])
        .resolves([hibernatedInstance]);
      mockStateStore.getInstancesByStatus
        .withArgs(["warm", "active"])
        .resolves([]);
      mockStateStore.getIdleInstances.resolves([]);
      mockEC2Ops.describeManagedInstances.resolves([
        { InstanceId: "i-hibernated", State: { Name: "stopped" } },
      ]);

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      // Should start hibernated instance, not launch new
      assert(mockEC2Ops.startInstance.calledWith("i-hibernated"));
      assert(!mockEC2Ops.launchInstance.called);
    });

    it("should not exceed max instances", async () => {
      const metrics = {
        pending_requests: 5,
        active_instances: 3, // Already at max
        warm_instances: 0,
        hibernated_instances: 0,
        total_capacity: 9,
        used_capacity: 9,
      };

      mockStateStore.getScalingMetrics.resolves(metrics);
      mockStateStore.getInstancesByStatus.resolves([]);
      mockStateStore.getIdleInstances.resolves([]);
      mockEC2Ops.describeManagedInstances.resolves([
        { InstanceId: "i-1", State: { Name: "running" } },
        { InstanceId: "i-2", State: { Name: "running" } },
        { InstanceId: "i-3", State: { Name: "running" } },
      ]);

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      // Should NOT launch new instance
      assert(!mockEC2Ops.launchInstance.called);
    });

    it("should hibernate idle instances", async () => {
      const metrics = {
        pending_requests: 0,
        active_instances: 0,
        warm_instances: 2, // More than minimum
        hibernated_instances: 0,
        total_capacity: 6,
        used_capacity: 0,
      };

      const idleInstance = {
        instance_id: "i-idle",
        status: "warm",
        current_sessions: 0,
        last_activity_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min idle
      };

      mockStateStore.getScalingMetrics.resolves(metrics);
      mockStateStore.getInstancesByStatus.resolves([]);
      mockStateStore.getIdleInstances.resolves([idleInstance]);
      mockEC2Ops.describeManagedInstances.resolves([
        { InstanceId: "i-idle", State: { Name: "running" } },
        { InstanceId: "i-active", State: { Name: "running" } },
      ]);

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      // Should hibernate idle instance
      assert(mockEC2Ops.stopInstance.calledWith("i-idle", true));
    });

    it("should sync database state with EC2 state", async () => {
      const metrics = {
        pending_requests: 0,
        active_instances: 0,
        warm_instances: 1,
        hibernated_instances: 0,
        total_capacity: 3,
        used_capacity: 0,
      };

      // Database shows instance as warm
      const dbInstance = {
        instance_id: "i-terminated",
        status: "warm",
      };

      mockStateStore.getScalingMetrics.resolves(metrics);
      mockStateStore.getInstancesByStatus
        .withArgs(["warm", "active"])
        .resolves([dbInstance]);
      mockStateStore.getInstancesByStatus.withArgs(["stopped"]).resolves([]);
      mockStateStore.getIdleInstances.resolves([]);

      // But EC2 shows instance as terminated
      mockEC2Ops.describeManagedInstances.resolves([]);

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 200);
      // Should delete the orphaned database record
      assert(mockStateStore.deleteInstance.calledWith("i-terminated"));
    });

    it("should handle errors gracefully", async () => {
      mockStateStore.getScalingMetrics.rejects(new Error("Database error"));

      const result = await handler.handler({});

      assert.strictEqual(result.statusCode, 500);
      const body = JSON.parse(result.body);
      assert(body.error.includes("Database error"));
    });
  });
});
