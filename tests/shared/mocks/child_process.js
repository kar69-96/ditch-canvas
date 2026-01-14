/**
 * Mock child_process module for testing
 * Provides controllable mock processes for spawn/exec testing
 */

const EventEmitter = require('events');

class MockChildProcess extends EventEmitter {
  constructor(command, args = [], options = {}) {
    super();
    this.command = command;
    this.args = args;
    this.options = options;
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this.pid = Math.floor(Math.random() * 10000) + 1000;

    // Mock stdio streams
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = new MockWritableStream();

    // Store for verification
    this.stdoutData = [];
    this.stderrData = [];
  }

  // Simulate stdout output
  emitStdout(data) {
    this.stdoutData.push(data);
    this.stdout.emit('data', Buffer.from(data));
  }

  // Simulate stderr output
  emitStderr(data) {
    this.stderrData.push(data);
    this.stderr.emit('data', Buffer.from(data));
  }

  // Simulate process exit
  emitExit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }

  // Simulate process error
  emitError(error) {
    this.emit('error', error);
  }

  // Kill the process
  kill(signal = 'SIGTERM') {
    if (!this.killed) {
      this.killed = true;
      this.signalCode = signal;
      this.emitExit(null, signal);
      return true;
    }
    return false;
  }

  // Send message (for IPC)
  send(message) {
    this.emit('message', message);
  }
}

class MockWritableStream extends EventEmitter {
  constructor() {
    super();
    this.written = [];
  }

  write(data) {
    this.written.push(data);
    return true;
  }

  end() {
    this.emit('finish');
  }
}

class MockChildProcessModule {
  constructor() {
    this.processes = [];
    this.spawnCalls = [];
    this.execCalls = [];
  }

  // Reset all tracked processes
  reset() {
    this.processes.forEach(proc => {
      if (!proc.killed) {
        proc.kill();
      }
    });
    this.processes = [];
    this.spawnCalls = [];
    this.execCalls = [];
  }

  // Mock spawn function
  spawn(command, args = [], options = {}) {
    const proc = new MockChildProcess(command, args, options);
    this.processes.push(proc);
    this.spawnCalls.push({ command, args, options, process: proc });

    // Auto-emit success after a short delay (can be overridden in tests)
    if (!options.noAutoComplete) {
      setTimeout(() => {
        if (!proc.killed && proc.exitCode === null) {
          proc.emitExit(0);
        }
      }, 10);
    }

    return proc;
  }

  // Mock exec function
  exec(command, options = {}, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const proc = new MockChildProcess(command, [], options);
    this.processes.push(proc);
    this.execCalls.push({ command, options, process: proc });

    // Auto-complete with success
    setTimeout(() => {
      if (callback) {
        callback(null, 'Mock stdout output', 'Mock stderr output');
      }
      proc.emitExit(0);
    }, 10);

    return proc;
  }

  // Mock execSync function
  execSync(command, options = {}) {
    this.execCalls.push({ command, options, sync: true });
    return Buffer.from('Mock execSync output');
  }

  // Mock fork function
  fork(modulePath, args = [], options = {}) {
    return this.spawn(process.execPath, [modulePath, ...args], {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
  }

  // Helper: Get process by command
  getProcessByCommand(command) {
    return this.processes.find(proc => proc.command === command);
  }

  // Helper: Get all processes
  getAllProcesses() {
    return this.processes;
  }

  // Helper: Verify spawn was called
  wasSpawnCalled(command) {
    return this.spawnCalls.some(call => call.command === command);
  }

  // Helper: Verify exec was called
  wasExecCalled(command) {
    return this.execCalls.some(call => call.command.includes(command));
  }
}

// Create singleton instance
const mockChildProcess = new MockChildProcessModule();

// Export
module.exports = {
  mockChildProcess,
  MockChildProcessModule,
  MockChildProcess,

  // Setup function for use in tests
  setupMockChildProcess: () => {
    mockChildProcess.reset();
    return mockChildProcess;
  },

  // Cleanup function
  cleanupMockChildProcess: () => {
    mockChildProcess.reset();
  },

  // Export individual functions for easy mocking
  spawn: (...args) => mockChildProcess.spawn(...args),
  exec: (...args) => mockChildProcess.exec(...args),
  execSync: (...args) => mockChildProcess.execSync(...args),
  fork: (...args) => mockChildProcess.fork(...args),
};
