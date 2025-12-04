#!/usr/bin/env node
/**
 * AWS EC2 Instance Manager
 * Handles starting and stopping EC2 instances for extraction jobs
 */

const { EC2Client, StartInstancesCommand, StopInstancesCommand, DescribeInstancesCommand } = require('@aws-sdk/client-ec2');

// Configuration from environment variables
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_INSTANCE_ID = process.env.AWS_INSTANCE_ID;
const AWS_WAIT_FOR_RUNNING = process.env.AWS_WAIT_FOR_RUNNING !== 'false'; // Default: wait for instance to be running
const AWS_WAIT_FOR_STOPPED = process.env.AWS_WAIT_FOR_STOPPED !== 'false'; // Default: wait for instance to be stopped

// Initialize EC2 client
const ec2Client = new EC2Client({ region: AWS_REGION });

/**
 * Wait for instance to reach a specific state
 */
async function waitForInstanceState(instanceId, targetState, maxWaitTime = 300000) {
  const startTime = Date.now();
  const pollInterval = 5000; // Check every 5 seconds
  
  console.log(`⏳ Waiting for instance ${instanceId} to reach state: ${targetState}...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const command = new DescribeInstancesCommand({
        InstanceIds: [instanceId]
      });
      const response = await ec2Client.send(command);
      
      if (response.Reservations && response.Reservations.length > 0) {
        const instance = response.Reservations[0].Instances[0];
        const currentState = instance.State.Name;
        
        if (currentState === targetState) {
          console.log(`✅ Instance ${instanceId} is now ${targetState}`);
          return true;
        }
        
        // If we're waiting for 'running' and it's in 'pending' or 'starting', that's normal - keep waiting
        if (targetState === 'running' && (currentState === 'pending' || currentState === 'starting')) {
          // This is expected - instance is starting up, keep waiting
        }
        
        // If we're waiting for 'running' but it's 'stopped', check if we've waited long enough
        // (it might have just been started and is transitioning)
        if (targetState === 'running' && currentState === 'stopped') {
          // Only fail if we've waited more than 10 seconds (to allow for transition time)
          const waitTime = Date.now() - startTime;
          if (waitTime > 10000) {
            console.log(`⚠️  Instance ${instanceId} is stopped and cannot reach running state (waited ${Math.round(waitTime/1000)}s)`);
            return false;
          }
          // Otherwise, keep waiting - it might be transitioning
        }
        
        // If we're waiting for 'stopped' but it's 'terminated', it's already stopped
        if (targetState === 'stopped' && currentState === 'terminated') {
          console.log(`⚠️  Instance ${instanceId} is terminated`);
          return false;
        }
        
        process.stdout.write(`   Current state: ${currentState}...\r`);
      }
    } catch (error) {
      console.error(`\n❌ Error checking instance state: ${error.message}`);
      return false;
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  console.log(`\n⚠️  Timeout waiting for instance ${instanceId} to reach ${targetState}`);
  return false;
}

/**
 * Get current instance state
 */
async function getInstanceState(instanceId) {
  try {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    });
    const response = await ec2Client.send(command);
    
    if (response.Reservations && response.Reservations.length > 0) {
      const instance = response.Reservations[0].Instances[0];
      return instance.State.Name;
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error getting instance state: ${error.message}`);
    return null;
  }
}

/**
 * Start EC2 instance
 */
async function startInstance(instanceId = AWS_INSTANCE_ID) {
  if (!instanceId) {
    console.error('❌ Error: AWS_INSTANCE_ID environment variable is not set');
    return { success: false, error: 'AWS_INSTANCE_ID not set' };
  }
  
  try {
    // Check current state first
    const currentState = await getInstanceState(instanceId);
    console.log(`\n🔍 Current instance state: ${currentState || 'unknown'}`);
    
    if (currentState === 'running') {
      console.log(`✅ Instance ${instanceId} is already running`);
      return { success: true, alreadyRunning: true, state: 'running' };
    }
    
    if (currentState === 'stopping') {
      console.log(`⏳ Instance ${instanceId} is stopping, waiting for it to stop...`);
      const reachedStopped = await waitForInstanceState(instanceId, 'stopped', 300000);
      if (!reachedStopped) {
        return { success: false, error: 'Instance did not stop within timeout' };
      }
      console.log(`✅ Instance ${instanceId} has stopped, proceeding to start...`);
    }
    
    if (currentState === 'terminated') {
      console.error(`❌ Instance ${instanceId} is terminated and cannot be started`);
      return { success: false, error: 'Instance is terminated' };
    }
    
    console.log(`🚀 Starting EC2 instance: ${instanceId}...`);
    
    const command = new StartInstancesCommand({
      InstanceIds: [instanceId]
    });
    
    const response = await ec2Client.send(command);
    
    if (response.StartingInstances && response.StartingInstances.length > 0) {
      const instance = response.StartingInstances[0];
      console.log(`✅ Instance start initiated. Current state: ${instance.CurrentState.Name}`);
      
      // Wait for instance to be running if configured
      if (AWS_WAIT_FOR_RUNNING) {
        const reachedRunning = await waitForInstanceState(instanceId, 'running');
        if (reachedRunning) {
          // Get the public IP address
          const finalState = await getInstanceState(instanceId);
          const describeCommand = new DescribeInstancesCommand({
            InstanceIds: [instanceId]
          });
          const describeResponse = await ec2Client.send(describeCommand);
          
          let publicIp = null;
          if (describeResponse.Reservations && describeResponse.Reservations.length > 0) {
            publicIp = describeResponse.Reservations[0].Instances[0].PublicIpAddress;
          }
          
          return { 
            success: true, 
            state: 'running',
            publicIp: publicIp,
            instanceId: instanceId
          };
        }
      }
      
      return { success: true, state: instance.CurrentState.Name, instanceId: instanceId };
    }
    
    return { success: false, error: 'No instance in response' };
  } catch (error) {
    console.error(`❌ Error starting instance: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get public IP address of instance
 */
async function getInstancePublicIp(instanceId = AWS_INSTANCE_ID) {
  if (!instanceId) {
    return null;
  }
  
  try {
    const command = new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    });
    const response = await ec2Client.send(command);
    
    if (response.Reservations && response.Reservations.length > 0) {
      const instance = response.Reservations[0].Instances[0];
      return instance.PublicIpAddress || null;
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error getting instance IP: ${error.message}`);
    return null;
  }
}

/**
 * Wait for SSH to be ready on instance
 */
async function waitForSSH(publicIp, maxWaitTime = 120000) {
  const net = require('net');
  
  const startTime = Date.now();
  const pollInterval = 5000; // Check every 5 seconds
  
  console.log(`⏳ Waiting for SSH to be ready on ${publicIp}...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Try to connect to port 22
      const socket = new net.Socket();
      const connected = await new Promise((resolve) => {
        socket.setTimeout(2000);
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.once('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(22, publicIp);
      });
      
      if (connected) {
        console.log(`✅ SSH is ready on ${publicIp}`);
        return true;
      }
    } catch (error) {
      // Continue waiting
    }
    
    process.stdout.write(`   Waiting for SSH...\r`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  console.log(`\n⚠️  Timeout waiting for SSH on ${publicIp}`);
  return false;
}

/**
 * Stop EC2 instance
 */
async function stopInstance(instanceId = AWS_INSTANCE_ID) {
  if (!instanceId) {
    console.error('❌ Error: AWS_INSTANCE_ID environment variable is not set');
    return { success: false, error: 'AWS_INSTANCE_ID not set' };
  }
  
  try {
    // Check current state first
    const currentState = await getInstanceState(instanceId);
    console.log(`\n🔍 Current instance state: ${currentState || 'unknown'}`);
    
    if (currentState === 'stopped' || currentState === 'stopping') {
      console.log(`✅ Instance ${instanceId} is already ${currentState}`);
      return { success: true, alreadyStopped: true, state: currentState };
    }
    
    if (currentState === 'terminated') {
      console.log(`⚠️  Instance ${instanceId} is already terminated`);
      return { success: true, alreadyStopped: true, state: 'terminated' };
    }
    
    console.log(`🛑 Stopping EC2 instance: ${instanceId}...`);
    
    const command = new StopInstancesCommand({
      InstanceIds: [instanceId]
    });
    
    const response = await ec2Client.send(command);
    
    if (response.StoppingInstances && response.StoppingInstances.length > 0) {
      const instance = response.StoppingInstances[0];
      console.log(`✅ Instance stop initiated. Current state: ${instance.CurrentState.Name}`);
      
      // Wait for instance to be stopped if configured
      if (AWS_WAIT_FOR_STOPPED) {
        const reachedStopped = await waitForInstanceState(instanceId, 'stopped');
        if (reachedStopped) {
          return { success: true, state: 'stopped', instanceId: instanceId };
        }
      }
      
      return { success: true, state: instance.CurrentState.Name, instanceId: instanceId };
    }
    
    return { success: false, error: 'No instance in response' };
  } catch (error) {
    console.error(`❌ Error stopping instance: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * High-level function: Ensure instance is ready and return connection info
 * Handles starting instance, waiting for SSH, etc.
 */
async function ensureInstanceReady(instanceId, publicIp = null) {
  if (!instanceId) {
    return { success: false, error: 'AWS_INSTANCE_ID not set' };
  }

  console.log('\n☁️  AWS EC2 Instance Management');
  console.log(`   Instance ID: ${instanceId}`);
  console.log(`   Region: ${AWS_REGION}`);

  // Check current state
  const currentState = await getInstanceState(instanceId);
  let wasAlreadyRunning = false;

  if (currentState === 'running') {
    console.log('✅ Instance is already running');
    wasAlreadyRunning = true;
    
    // Get public IP if not provided
    if (!publicIp) {
      publicIp = await getInstancePublicIp(instanceId);
      if (!publicIp) {
        return { success: false, error: 'Could not get public IP address of running instance' };
      }
    }
    console.log(`   Public IP: ${publicIp}`);
  } else {
    // Start the instance
    console.log(`🚀 Starting instance (current state: ${currentState || 'unknown'})...`);
    const startResult = await startInstance(instanceId);
    
    if (!startResult.success) {
      return { success: false, error: `Failed to start instance: ${startResult.error}` };
    }
    
    // If instance wasn't already running, check if startInstance already waited
    // (startInstance waits if AWS_WAIT_FOR_RUNNING is true, which is the default)
    if (!startResult.alreadyRunning && !startResult.publicIp) {
      // startInstance didn't wait or didn't get public IP, so wait now
      const reachedRunning = await waitForInstanceState(instanceId, 'running', 300000);
      if (!reachedRunning) {
        return { success: false, error: 'Instance did not reach running state within timeout' };
      }
    }
    
    // Get public IP - retry a few times as it might not be available immediately
    publicIp = startResult.publicIp;
    if (!publicIp) {
      for (let i = 0; i < 10; i++) {
        publicIp = await getInstancePublicIp(instanceId);
        if (publicIp) break;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between retries
      }
    }
    
    if (!publicIp) {
      return { success: false, error: 'Could not get public IP address after starting instance' };
    }
    console.log(`   Public IP: ${publicIp}`);
    
    // Wait for SSH to be ready
    const sshReady = await waitForSSH(publicIp);
    if (!sshReady) {
      return { success: false, error: 'SSH not ready after timeout' };
    }
  }

  return {
    success: true,
    publicIp,
    instanceId,
    wasAlreadyRunning
  };
}

/**
 * Execute command on AWS instance via SSH with real-time output streaming
 */
async function executeCommand(publicIp, command, keyFile) {
  if (!keyFile) {
    return { success: false, error: 'AWS_KEY_FILE is required for SSH access' };
  }

  const { spawn } = require('child_process');
  
  // Try ec2-user first (default for Amazon Linux), then ubuntu (for Ubuntu instances)
  const sshUser = process.env.AWS_SSH_USER || 'ec2-user';
  const sshCommand = `ssh -i "${keyFile}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${sshUser}@${publicIp} "${command}"`;
  
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', sshCommand], {
      env: { ...process.env },
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    // Stream stdout in real-time
    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      process.stdout.write(output); // Write to console immediately
    });
    
    // Stream stderr in real-time
    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      process.stderr.write(output); // Write to console immediately
    });
    
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code
      });
    });
    
    child.on('error', (error) => {
      resolve({
        success: false,
        error: error.message,
        stdout,
        stderr
      });
    });
  });
}

/**
 * Cleanup: Stop instance when extraction completes
 * @param {string} instanceId - The instance ID to stop
 * @param {boolean} wasAlreadyRunning - Whether instance was already running (for logging)
 * @param {boolean} forceStop - If true, stop instance even if it was already running (default: true)
 */
async function cleanup(instanceId, wasAlreadyRunning, forceStop = true) {
  if (!forceStop && wasAlreadyRunning) {
    console.log('\n☁️  Instance was already running - keeping it running');
    return { success: true, message: 'Instance kept running' };
  }

  if (wasAlreadyRunning) {
    console.log('\n☁️  Stopping AWS EC2 instance (extraction completed)...');
  } else {
    console.log('\n☁️  Stopping AWS EC2 instance (we started it)...');
  }
  
  const stopResult = await stopInstance(instanceId);
  
  if (stopResult.success) {
    console.log('✅ AWS instance stopped successfully');
    return { success: true };
  } else {
    console.error(`❌ Failed to stop AWS instance: ${stopResult.error}`);
    console.error('   Please stop the instance manually to avoid charges!');
    return { success: false, error: stopResult.error };
  }
}

module.exports = {
  // Low-level functions
  startInstance,
  stopInstance,
  getInstanceState,
  waitForInstanceState,
  getInstancePublicIp,
  waitForSSH,
  // High-level functions
  ensureInstanceReady,
  executeCommand,
  cleanup
};

