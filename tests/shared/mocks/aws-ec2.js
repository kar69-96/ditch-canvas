/**
 * Mock AWS EC2 client for testing
 * Provides in-memory EC2 instance management without requiring real AWS calls
 */

class MockEC2Client {
  constructor() {
    this.instances = new Map();
    this.instanceCounter = 0;
    this.shouldFail = false;
    this.failureError = null;
  }

  reset() {
    this.instances.clear();
    this.instanceCounter = 0;
    this.shouldFail = false;
    this.failureError = null;
  }

  setFailure(error) {
    this.shouldFail = true;
    this.failureError = error;
  }

  clearFailure() {
    this.shouldFail = false;
    this.failureError = null;
  }

  // Seed instance for testing
  seedInstance(instanceId, state = "running", tags = []) {
    this.instances.set(instanceId, {
      InstanceId: instanceId,
      State: { Name: state },
      PublicIpAddress: `10.0.0.${this.instances.size + 1}`,
      Tags: tags,
      LaunchTime: new Date().toISOString(),
    });
  }

  async send(command) {
    if (this.shouldFail) {
      throw this.failureError || new Error("Mock EC2 failure");
    }

    const commandName = command.constructor.name;

    switch (commandName) {
      case "RunInstancesCommand":
        return this._runInstances(command.input);
      case "StartInstancesCommand":
        return this._startInstances(command.input);
      case "StopInstancesCommand":
        return this._stopInstances(command.input);
      case "TerminateInstancesCommand":
        return this._terminateInstances(command.input);
      case "DescribeInstancesCommand":
        return this._describeInstances(command.input);
      default:
        throw new Error(`Unknown command: ${commandName}`);
    }
  }

  _runInstances(input) {
    const instanceId = `i-mock${String(++this.instanceCounter).padStart(8, "0")}`;
    const instance = {
      InstanceId: instanceId,
      State: { Name: "pending" },
      PublicIpAddress: null,
      PrivateIpAddress: `10.0.0.${this.instanceCounter}`,
      Tags: input.TagSpecifications?.[0]?.Tags || [],
      LaunchTime: new Date().toISOString(),
      ImageId: input.ImageId,
      InstanceType: input.InstanceType,
    };

    this.instances.set(instanceId, instance);

    // Simulate instance becoming running after a short delay
    setTimeout(() => {
      const inst = this.instances.get(instanceId);
      if (inst && inst.State.Name === "pending") {
        inst.State.Name = "running";
        inst.PublicIpAddress = `52.0.0.${this.instanceCounter}`;
      }
    }, 100);

    return {
      Instances: [instance],
    };
  }

  _startInstances(input) {
    const results = [];
    for (const instanceId of input.InstanceIds) {
      const instance = this.instances.get(instanceId);
      if (instance) {
        const previousState = instance.State.Name;
        instance.State.Name = "pending";
        results.push({
          InstanceId: instanceId,
          PreviousState: { Name: previousState },
          CurrentState: { Name: "pending" },
        });

        // Simulate becoming running
        setTimeout(() => {
          const inst = this.instances.get(instanceId);
          if (inst) {
            inst.State.Name = "running";
            inst.PublicIpAddress =
              inst.PublicIpAddress || `52.0.0.${this.instanceCounter}`;
          }
        }, 100);
      }
    }

    return { StartingInstances: results };
  }

  _stopInstances(input) {
    const results = [];
    for (const instanceId of input.InstanceIds) {
      const instance = this.instances.get(instanceId);
      if (instance) {
        const previousState = instance.State.Name;
        instance.State.Name = input.Hibernate ? "stopping" : "stopping";
        results.push({
          InstanceId: instanceId,
          PreviousState: { Name: previousState },
          CurrentState: { Name: "stopping" },
        });

        // Simulate becoming stopped
        setTimeout(() => {
          const inst = this.instances.get(instanceId);
          if (inst) {
            inst.State.Name = "stopped";
            inst.PublicIpAddress = null;
          }
        }, 100);
      }
    }

    return { StoppingInstances: results };
  }

  _terminateInstances(input) {
    const results = [];
    for (const instanceId of input.InstanceIds) {
      const instance = this.instances.get(instanceId);
      if (instance) {
        const previousState = instance.State.Name;
        instance.State.Name = "shutting-down";
        results.push({
          InstanceId: instanceId,
          PreviousState: { Name: previousState },
          CurrentState: { Name: "shutting-down" },
        });

        // Simulate becoming terminated
        setTimeout(() => {
          const inst = this.instances.get(instanceId);
          if (inst) {
            inst.State.Name = "terminated";
          }
        }, 100);
      }
    }

    return { TerminatingInstances: results };
  }

  _describeInstances(input) {
    let instances = Array.from(this.instances.values());

    // Filter by instance IDs if provided
    if (input.InstanceIds && input.InstanceIds.length > 0) {
      instances = instances.filter((i) =>
        input.InstanceIds.includes(i.InstanceId),
      );
    }

    // Filter by tags if provided
    if (input.Filters) {
      for (const filter of input.Filters) {
        if (filter.Name === "tag:Service") {
          instances = instances.filter((i) =>
            i.Tags.some(
              (t) => t.Key === "Service" && filter.Values.includes(t.Value),
            ),
          );
        }
        if (filter.Name === "tag:ManagedBy") {
          instances = instances.filter((i) =>
            i.Tags.some(
              (t) => t.Key === "ManagedBy" && filter.Values.includes(t.Value),
            ),
          );
        }
        if (filter.Name === "instance-state-name") {
          instances = instances.filter((i) =>
            filter.Values.includes(i.State.Name),
          );
        }
      }
    }

    return {
      Reservations: instances.length > 0 ? [{ Instances: instances }] : [],
    };
  }
}

// Mock command classes
class RunInstancesCommand {
  constructor(input) {
    this.input = input;
  }
}

class StartInstancesCommand {
  constructor(input) {
    this.input = input;
  }
}

class StopInstancesCommand {
  constructor(input) {
    this.input = input;
  }
}

class TerminateInstancesCommand {
  constructor(input) {
    this.input = input;
  }
}

class DescribeInstancesCommand {
  constructor(input) {
    this.input = input;
  }
}

// Mock waiters
async function waitUntilInstanceRunning(config, input) {
  const client = config.client;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const result = await client.send(new DescribeInstancesCommand(input));
    const instances = result.Reservations?.[0]?.Instances || [];

    if (instances.every((i) => i.State.Name === "running")) {
      return { state: "SUCCESS" };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timeout waiting for instance to run");
}

async function waitUntilInstanceStopped(config, input) {
  const client = config.client;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const result = await client.send(new DescribeInstancesCommand(input));
    const instances = result.Reservations?.[0]?.Instances || [];

    if (instances.every((i) => i.State.Name === "stopped")) {
      return { state: "SUCCESS" };
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timeout waiting for instance to stop");
}

// Singleton instance
const mockEC2Client = new MockEC2Client();

module.exports = {
  EC2Client: function () {
    return mockEC2Client;
  },
  mockEC2Client,
  MockEC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  DescribeInstancesCommand,
  waitUntilInstanceRunning,
  waitUntilInstanceStopped,
};
