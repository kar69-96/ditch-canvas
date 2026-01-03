const fs = require('fs');
const path = require('path');

class OverridesService {
  constructor(options = {}) {
    this.overrideFile =
      options.overrideFile || path.join(__dirname, '..', '..', 'data', 'assignment-overrides.json');
  }

  ensureFileDirectory() {
    const dir = path.dirname(this.overrideFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  readOverrides() {
    try {
      if (!fs.existsSync(this.overrideFile)) {
        return {};
      }
      const contents = fs.readFileSync(this.overrideFile, 'utf8');
      return JSON.parse(contents);
    } catch (error) {
      console.warn('⚠️ Failed to read overrides file, starting fresh:', error.message);
      return {};
    }
  }

  writeOverrides(map) {
    this.ensureFileDirectory();
    fs.writeFileSync(this.overrideFile, JSON.stringify(map, null, 2));
  }

  formatOverride(assignmentId, payload) {
    if (!payload) {
      return {
        id: assignmentId,
        canvas_id: assignmentId,
        manual_status_override: null,
        submission_status: 'unsubmitted',
        effective_status: 'unsubmitted',
        override_reason: null,
        override_updated_at: null,
        override_updated_by: null,
      };
    }

    const status = payload.status ?? payload.manual_status_override ?? 'unsubmitted';
    return {
      id: assignmentId,
      canvas_id: assignmentId,
      manual_status_override: payload.status ?? null,
      submission_status: status,
      effective_status: status,
      override_reason: payload.reason ?? null,
      override_updated_at: payload.updatedAt ?? null,
      override_updated_by: payload.updatedBy ?? null,
    };
  }

  async getOverridesMap() {
    const map = new Map();
    const raw = this.readOverrides();
    Object.entries(raw).forEach(([assignmentId, payload]) => {
      map.set(String(assignmentId), payload);
    });
    return map;
  }

  async setOverride(assignmentId, status, reason = null) {
    const overrides = this.readOverrides();
    if (status == null) {
      delete overrides[assignmentId];
    } else {
      overrides[assignmentId] = {
        status,
        reason: reason || null,
        updatedAt: new Date().toISOString(),
      };
    }
    this.writeOverrides(overrides);
    return this.formatOverride(assignmentId, overrides[assignmentId]);
  }

  async removeOverride(assignmentId) {
    const overrides = this.readOverrides();
    delete overrides[assignmentId];
    this.writeOverrides(overrides);
    return this.formatOverride(assignmentId, null);
  }
}

module.exports = OverridesService;
