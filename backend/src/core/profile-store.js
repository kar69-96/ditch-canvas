const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'browserbase');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadProfile() {
  if (!fs.existsSync(PROFILE_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(PROFILE_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${PROFILE_FILE}: ${error.message}`);
  }
}

function saveProfile(profile) {
  ensureDataDir();
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
}

function updateStatus(status) {
  ensureDataDir();
  const payload = {
    ...status,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(payload, null, 2));
  return payload;
}

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${STATUS_FILE}: ${error.message}`);
  }
}

module.exports = {
  loadProfile,
  saveProfile,
  updateStatus,
  loadStatus,
  PROFILE_FILE,
  STATUS_FILE,
};
