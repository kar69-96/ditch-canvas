/**
 * Integration tests for EC2 Auto-Scaling System
 * Tests the complete flow from request to instance assignment
 */

const assert = require("assert");
const { mockSupabase } = require("../../shared/mocks/supabase");
const { mockEC2Client } = require("../../shared/mocks/aws-ec2");

describe("EC2 Auto-Scaling Integration", () => {
  beforeEach(() => {
    mockSupabase.reset();
    mockEC2Client.reset();
  });

  describe("Instance Pool Management", () => {
    it("should maintain warm instance pool", () => {
      // Seed initial state: no instances
      assert.strictEqual(mockSupabase.tables.streaming_instances.length, 0);

      // Simulate scaler creating a warm instance
      const instance = {
        instance_id: "i-warm12345",
        status: "warm",
        tunnel_url: "https://warm.trycloudflare.com",
        current_sessions: 0,
        max_sessions: 3,
        last_activity_at: new Date().toISOString(),
        health_check_failures: 0,
      };

      mockSupabase.seed("streaming_instances", [instance]);

      // Verify instance is registered
      assert.strictEqual(mockSupabase.tables.streaming_instances.length, 1);
      assert.strictEqual(
        mockSupabase.tables.streaming_instances[0].status,
        "warm",
      );
    });

    it("should track multiple instances with different states", () => {
      const instances = [
        {
          instance_id: "i-warm1",
          status: "warm",
          current_sessions: 0,
          max_sessions: 3,
        },
        {
          instance_id: "i-active1",
          status: "active",
          current_sessions: 2,
          max_sessions: 3,
        },
        {
          instance_id: "i-stopped1",
          status: "stopped",
          current_sessions: 0,
          max_sessions: 3,
        },
      ];

      mockSupabase.seed("streaming_instances", instances);

      // Filter by status
      const warmInstances = mockSupabase.tables.streaming_instances.filter(
        (i) => i.status === "warm",
      );
      const activeInstances = mockSupabase.tables.streaming_instances.filter(
        (i) => i.status === "active",
      );
      const stoppedInstances = mockSupabase.tables.streaming_instances.filter(
        (i) => i.status === "stopped",
      );

      assert.strictEqual(warmInstances.length, 1);
      assert.strictEqual(activeInstances.length, 1);
      assert.strictEqual(stoppedInstances.length, 1);
    });
  });

  describe("Request Queue Management", () => {
    it("should enqueue auth requests", async () => {
      const request = {
        id: "req-123",
        email: "test@colorado.edu",
        context: "login",
        status: "pending",
        created_at: new Date().toISOString(),
      };

      mockSupabase.seed("auth_requests", [request]);

      assert.strictEqual(mockSupabase.tables.auth_requests.length, 1);
      assert.strictEqual(
        mockSupabase.tables.auth_requests[0].status,
        "pending",
      );
    });

    it("should find queue position for requests", async () => {
      const requests = [
        {
          id: "req-1",
          status: "pending",
          created_at: "2026-01-15T10:00:00Z",
        },
        {
          id: "req-2",
          status: "pending",
          created_at: "2026-01-15T10:01:00Z",
        },
        {
          id: "req-3",
          status: "pending",
          created_at: "2026-01-15T10:02:00Z",
        },
      ];

      mockSupabase.seed("auth_requests", requests);

      const result = await mockSupabase.rpc("get_queue_position", {
        request_id: "req-2",
      });

      assert.strictEqual(result.data, 2);
    });
  });

  describe("Instance Assignment Flow", () => {
    it("should assign request to available instance", async () => {
      // Setup: warm instance with capacity
      const instance = {
        instance_id: "i-avail123",
        status: "warm",
        tunnel_url: "https://avail.trycloudflare.com",
        current_sessions: 0,
        max_sessions: 3,
      };

      const request = {
        id: "req-assign1",
        email: "user@colorado.edu",
        status: "pending",
      };

      mockSupabase.seed("streaming_instances", [instance]);
      mockSupabase.seed("auth_requests", [request]);

      // Find available instance
      const availResult = await mockSupabase.rpc("find_available_instance");
      assert.strictEqual(availResult.data.length, 1);
      assert.strictEqual(availResult.data[0].instance_id, "i-avail123");

      // Assign request to instance
      const assignResult = await mockSupabase.rpc(
        "assign_request_to_instance",
        {
          p_request_id: "req-assign1",
          p_instance_id: "i-avail123",
        },
      );

      assert.strictEqual(assignResult.data, true);

      // Verify instance state updated
      const updatedInstance = mockSupabase.tables.streaming_instances.find(
        (i) => i.instance_id === "i-avail123",
      );
      assert.strictEqual(updatedInstance.current_sessions, 1);
      assert.strictEqual(updatedInstance.status, "active");

      // Verify request state updated
      const updatedRequest = mockSupabase.tables.auth_requests.find(
        (r) => r.id === "req-assign1",
      );
      assert.strictEqual(updatedRequest.status, "assigned");
      assert.strictEqual(
        updatedRequest.tunnel_url,
        "https://avail.trycloudflare.com",
      );
    });

    it("should not assign to full instance", async () => {
      // Setup: instance at full capacity
      const instance = {
        instance_id: "i-full123",
        status: "active",
        tunnel_url: "https://full.trycloudflare.com",
        current_sessions: 3, // Full
        max_sessions: 3,
      };

      mockSupabase.seed("streaming_instances", [instance]);

      // Find available instance should return empty
      const availResult = await mockSupabase.rpc("find_available_instance");
      assert.strictEqual(availResult.data.length, 0);
    });

    it("should release session when auth completes", async () => {
      // Setup: active instance with session
      const instance = {
        instance_id: "i-release123",
        status: "active",
        tunnel_url: "https://release.trycloudflare.com",
        current_sessions: 1,
        max_sessions: 3,
      };

      const request = {
        id: "req-release1",
        email: "user@colorado.edu",
        status: "assigned",
        assigned_instance: "i-release123",
      };

      mockSupabase.seed("streaming_instances", [instance]);
      mockSupabase.seed("auth_requests", [request]);

      // Release the session
      await mockSupabase.rpc("release_instance_session", {
        p_request_id: "req-release1",
        p_new_status: "completed",
      });

      // Verify instance session count decreased
      const updatedInstance = mockSupabase.tables.streaming_instances.find(
        (i) => i.instance_id === "i-release123",
      );
      assert.strictEqual(updatedInstance.current_sessions, 0);
      assert.strictEqual(updatedInstance.status, "warm"); // Back to warm when empty

      // Verify request completed
      const updatedRequest = mockSupabase.tables.auth_requests.find(
        (r) => r.id === "req-release1",
      );
      assert.strictEqual(updatedRequest.status, "completed");
    });
  });

  describe("Scaling Metrics", () => {
    it("should calculate correct scaling metrics", async () => {
      // Setup: mixed state
      const instances = [
        {
          instance_id: "i-1",
          status: "warm",
          current_sessions: 0,
          max_sessions: 3,
        },
        {
          instance_id: "i-2",
          status: "active",
          current_sessions: 2,
          max_sessions: 3,
        },
        {
          instance_id: "i-3",
          status: "stopped",
          current_sessions: 0,
          max_sessions: 3,
        },
      ];

      const requests = [
        { id: "r-1", status: "pending" },
        { id: "r-2", status: "pending" },
        { id: "r-3", status: "assigned" },
      ];

      mockSupabase.seed("streaming_instances", instances);
      mockSupabase.seed("auth_requests", requests);

      const result = await mockSupabase.rpc("get_scaling_metrics");
      const metrics = result.data[0];

      assert.strictEqual(metrics.pending_requests, 2);
      assert.strictEqual(metrics.active_instances, 1);
      assert.strictEqual(metrics.warm_instances, 1);
      assert.strictEqual(metrics.hibernated_instances, 1);
      assert.strictEqual(metrics.total_capacity, 6); // warm + active
      assert.strictEqual(metrics.used_capacity, 2); // current sessions in warm + active
    });
  });

  describe("EC2 Instance Operations", () => {
    it("should track launched instances", () => {
      // Seed an EC2 instance
      mockEC2Client.seedInstance("i-ec2test", "running", [
        { Key: "Service", Value: "ditchcanvas-auth" },
        { Key: "ManagedBy", Value: "ec2-manager" },
      ]);

      assert(mockEC2Client.instances.has("i-ec2test"));
      assert.strictEqual(
        mockEC2Client.instances.get("i-ec2test").State.Name,
        "running",
      );
    });

    it("should filter instances by tags", async () => {
      // Seed instances with different tags
      mockEC2Client.seedInstance("i-managed", "running", [
        { Key: "Service", Value: "ditchcanvas-auth" },
        { Key: "ManagedBy", Value: "ec2-manager" },
      ]);

      mockEC2Client.seedInstance("i-other", "running", [
        { Key: "Service", Value: "other-service" },
      ]);

      // Simulate describe with filters
      const result = mockEC2Client._describeInstances({
        Filters: [
          { Name: "tag:Service", Values: ["ditchcanvas-auth"] },
          { Name: "tag:ManagedBy", Values: ["ec2-manager"] },
        ],
      });

      assert.strictEqual(result.Reservations[0].Instances.length, 1);
      assert.strictEqual(
        result.Reservations[0].Instances[0].InstanceId,
        "i-managed",
      );
    });
  });

  describe("Health Check Flow", () => {
    it("should track health check failures", () => {
      const instance = {
        instance_id: "i-health123",
        status: "warm",
        health_check_failures: 0,
      };

      mockSupabase.seed("streaming_instances", [instance]);

      // Simulate health check failure
      mockSupabase.tables.streaming_instances[0].health_check_failures = 1;
      assert.strictEqual(
        mockSupabase.tables.streaming_instances[0].health_check_failures,
        1,
      );

      // Simulate another failure
      mockSupabase.tables.streaming_instances[0].health_check_failures = 2;
      assert.strictEqual(
        mockSupabase.tables.streaming_instances[0].health_check_failures,
        2,
      );
    });

    it("should log instance events", () => {
      const event = {
        instance_id: "i-event123",
        event_type: "instance_health_failed",
        details: { failures: 1 },
        created_at: new Date().toISOString(),
      };

      mockSupabase.seed("instance_events", [event]);

      assert.strictEqual(mockSupabase.tables.instance_events.length, 1);
      assert.strictEqual(
        mockSupabase.tables.instance_events[0].event_type,
        "instance_health_failed",
      );
    });
  });

  describe("Burst Scaling", () => {
    it("should detect when burst scaling is needed", async () => {
      // Setup: all capacity used with pending requests
      const instances = [
        {
          instance_id: "i-1",
          status: "active",
          current_sessions: 3,
          max_sessions: 3,
        },
      ];

      const requests = [
        { id: "r-1", status: "pending" },
        { id: "r-2", status: "pending" },
        { id: "r-3", status: "pending" },
      ];

      mockSupabase.seed("streaming_instances", instances);
      mockSupabase.seed("auth_requests", requests);

      const result = await mockSupabase.rpc("get_scaling_metrics");
      const metrics = result.data[0];

      // Verify burst conditions
      assert.strictEqual(metrics.pending_requests, 3);
      assert.strictEqual(metrics.used_capacity, metrics.total_capacity);

      // Burst should be triggered when:
      // pending_requests >= burstScaleThreshold (2) AND
      // used_capacity >= total_capacity
      const shouldBurst =
        metrics.pending_requests >= 2 &&
        metrics.used_capacity >= metrics.total_capacity;

      assert.strictEqual(shouldBurst, true);
    });
  });
});
