const assert = require('assert');
const fs = require('fs');
const path = require('path');
const OverridesService = require('../../src/core/overrides-service');

describe('OverridesService', () => {
  let service;
  let testFile;

  beforeEach(() => {
    // Create a temporary test file
    testFile = path.join(__dirname, '..', 'fixtures', 'test-overrides.json');
    const dir = path.dirname(testFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    service = new OverridesService({ overrideFile: testFile });
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('formatOverride', () => {
    it('should return default format for null payload', () => {
      const result = service.formatOverride('123', null);
      assert.strictEqual(result.id, '123');
      assert.strictEqual(result.manual_status_override, null);
      assert.strictEqual(result.effective_status, 'unsubmitted');
    });

    it('should format override with status', () => {
      const result = service.formatOverride('123', { status: 'completed', reason: 'Test' });
      assert.strictEqual(result.manual_status_override, 'completed');
      assert.strictEqual(result.override_reason, 'Test');
    });
  });

  describe('getOverridesMap', () => {
    it('should return empty map for non-existent file', async () => {
      const map = await service.getOverridesMap();
      assert(map instanceof Map);
      assert.strictEqual(map.size, 0);
    });

    it('should return map with existing overrides', async () => {
      // Write test data
      fs.writeFileSync(testFile, JSON.stringify({
        '123': { status: 'completed', reason: 'Test' },
        '456': { status: 'excused', reason: 'Sick' }
      }));

      const map = await service.getOverridesMap();
      assert.strictEqual(map.size, 2);
      assert(map.has('123'));
      assert.strictEqual(map.get('123').status, 'completed');
    });
  });

  describe('setOverride', () => {
    it('should create new override', async () => {
      const result = await service.setOverride('123', 'completed', 'Test reason');
      assert.strictEqual(result.manual_status_override, 'completed');
      assert.strictEqual(result.override_reason, 'Test reason');
      
      // Verify file was written
      assert(fs.existsSync(testFile));
      const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      assert.strictEqual(data['123'].status, 'completed');
    });

    it('should update existing override', async () => {
      // Create initial override
      await service.setOverride('123', 'completed', 'Initial');
      
      // Update it
      await service.setOverride('123', 'excused', 'Updated');
      
      const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      assert.strictEqual(data['123'].status, 'excused');
      assert.strictEqual(data['123'].reason, 'Updated');
    });

    it('should delete override when status is null', async () => {
      // Create override
      await service.setOverride('123', 'completed', 'Test');
      
      // Delete it
      await service.setOverride('123', null);
      
      const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      assert.strictEqual(data['123'], undefined);
    });
  });

  describe('removeOverride', () => {
    it('should remove override', async () => {
      // Create overrides
      fs.writeFileSync(testFile, JSON.stringify({
        '123': { status: 'completed' },
        '456': { status: 'excused' }
      }));

      await service.removeOverride('123');
      
      const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      assert.strictEqual(data['123'], undefined);
      assert(data['456']);
    });

    it('should not error when removing non-existent override', async () => {
      await service.removeOverride('999');
      // Should not throw
    });
  });

  describe('ensureFileDirectory', () => {
    it('should create directory if not exists', () => {
      const deepPath = path.join(__dirname, '..', 'fixtures', 'deep', 'nested', 'overrides.json');
      const deepService = new OverridesService({ overrideFile: deepPath });
      
      deepService.ensureFileDirectory();
      
      assert(fs.existsSync(path.dirname(deepPath)));
      
      // Cleanup
      fs.rmdirSync(path.dirname(deepPath), { recursive: true });
    });
  });
});

