/**
 * Mock file system for testing
 * Uses memfs to provide an in-memory file system
 */

const { Volume } = require('memfs');
const path = require('path');

class MockFileSystem {
  constructor() {
    this.volume = new Volume();
    this.files = {};
  }

  // Reset the file system
  reset() {
    this.volume = new Volume();
    this.files = {};
  }

  // Create a virtual file system with initial files
  setup(files = {}) {
    this.files = files;
    this.volume.fromJSON(files, '/');
  }

  // Get the mocked fs module
  getMockedFs() {
    return this.volume;
  }

  // Helper: Create directory structure
  createDirectory(dirPath) {
    this.volume.mkdirSync(dirPath, { recursive: true });
  }

  // Helper: Write file
  writeFile(filePath, content) {
    const dir = path.dirname(filePath);
    this.createDirectory(dir);
    this.volume.writeFileSync(filePath, content);
  }

  // Helper: Read file
  readFile(filePath) {
    return this.volume.readFileSync(filePath, 'utf8');
  }

  // Helper: Check if file exists
  exists(filePath) {
    return this.volume.existsSync(filePath);
  }

  // Helper: List directory contents
  readDir(dirPath) {
    return this.volume.readdirSync(dirPath);
  }

  // Helper: Delete file
  deleteFile(filePath) {
    this.volume.unlinkSync(filePath);
  }

  // Helper: Get file stats
  getStats(filePath) {
    return this.volume.statSync(filePath);
  }

  // Create typical test directory structure
  createTestStructure() {
    this.createDirectory('/data/auth');
    this.createDirectory('/data/overrides');
    this.createDirectory('/storage/files');
    this.createDirectory('/output');
  }

  // Add sample cookie file
  addCookieFile(email, cookies) {
    const normalizedEmail = email.replace(/@/g, '_at_').replace(/\./g, '_');
    const cookiePath = `/data/auth/${normalizedEmail}_cookies.json`;
    this.writeFile(cookiePath, JSON.stringify(cookies, null, 2));
    return cookiePath;
  }

  // Add sample override file
  addOverrideFile(email, overrides) {
    const overridePath = `/data/overrides/${email.replace(/@/g, '_at_').replace(/\./g, '_')}_overrides.json`;
    this.writeFile(overridePath, JSON.stringify(overrides, null, 2));
    return overridePath;
  }

  // Get all files as JSON
  toJSON() {
    return this.volume.toJSON();
  }
}

// Create singleton instance
const mockFs = new MockFileSystem();

// Export both the instance and the class
module.exports = {
  mockFs,
  MockFileSystem,

  // Convenience method to get mocked fs for proxyquire/rewire
  getMockedFs: () => mockFs.getMockedFs(),

  // Setup function for use in beforeEach
  setupMockFs: (files = {}) => {
    mockFs.reset();
    mockFs.setup(files);
    mockFs.createTestStructure();
    return mockFs;
  },

  // Cleanup function for use in afterEach
  cleanupMockFs: () => {
    mockFs.reset();
  },
};
