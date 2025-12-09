const crypto = require('crypto');

// In-memory session store. For production you may want Redis or DB.
const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function generateToken() {
  return crypto.randomUUID();
}

function createSession({ sessionToken = generateToken(), vncUrl, callbackUrl, ttlMs = 10 * 60 * 1000 }) { // 10 minutes to match login timeout
  const expiresAt = Date.now() + ttlMs;
  const session = {
    sessionToken,
    vncUrl,
    callbackUrl,
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt,
    cookies: null,
    username: null,
    error: null
  };
  sessions.set(sessionToken, session);
  return session;
}

function getSession(token) {
  return sessions.get(token) || null;
}

function setStatus(token, status) {
  const session = sessions.get(token);
  if (!session) return null;
  session.status = status;
  session.updatedAt = nowIso();
  sessions.set(token, session);
  return session;
}

function markActive(token) {
  return setStatus(token, 'active');
}

function completeSession(token, { cookies, username, metadata }) {
  const session = sessions.get(token);
  if (!session) return null;
  session.status = 'completed';
  session.cookies = cookies || null;
  session.username = username || null;
  session.metadata = metadata || null;
  session.updatedAt = nowIso();
  sessions.set(token, session);
  return session;
}

function failSession(token, error) {
  const session = sessions.get(token);
  if (!session) return null;
  session.status = 'error';
  session.error = error;
  session.updatedAt = nowIso();
  sessions.set(token, session);
  return session;
}

function cancelSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  session.status = 'cancelled';
  session.updatedAt = nowIso();
  sessions.set(token, session);
  return session;
}

function cleanupExpired() {
  const now = Date.now();
  const removed = [];
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      sessions.delete(token);
      removed.push(token);
    }
  }
  return removed;
}

module.exports = {
  sessions,
  generateToken,
  createSession,
  getSession,
  setStatus,
  markActive,
  completeSession,
  failSession,
  cancelSession,
  cleanupExpired
};

