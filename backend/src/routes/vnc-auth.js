const express = require('express');
const path = require('path');
const {
  ensureInstanceReady,
  executeCommand,
  stopInstance
} = require('../../aws/utils/aws-ec2-manager');
const sessionManager = require('../../aws/vnc-login/session-manager');

const router = express.Router();

const VNC_INSTANCE_ID = process.env.VNC_INSTANCE_ID || process.env.AWS_INSTANCE_ID;
const VNC_INSTANCE_IP = process.env.VNC_INSTANCE_IP || null; // optional static/Elastic IP
const VNC_SSH_KEY_PATH = process.env.VNC_SSH_KEY_PATH || process.env.AWS_KEY_FILE;
const VNC_SSH_USER = process.env.VNC_SSH_USER || 'ec2-user';
const VNC_REMOTE_SCRIPT_PATH = process.env.VNC_REMOTE_SCRIPT_PATH || '/opt/app/vnc-login.js';
const VNC_CALLBACK_URL = process.env.VNC_CALLBACK_URL || null;
const VNC_NOVNC_PORT = process.env.VNC_NOVNC_PORT || '80';
const VNC_LOGIN_TIMEOUT_MS = parseInt(process.env.VNC_LOGIN_TIMEOUT_MS || '300000', 10);

function buildNoVncUrl(publicIp, sessionToken) {
  const base = `http://${publicIp}:${VNC_NOVNC_PORT}`;
  // Use full vnc.html interface for better input handling
  // - host/port: where websockify is listening (port 80)
  // - path: 'websockify' - this is the default WebSocket path that websockify uses
  // - encrypt=0: plain WebSocket (ws://) to avoid TLS warnings
  // - autoconnect=true: connect immediately without showing connect dialog
  // - resize=remote: remote resizing for best view
  // - view_only=false: allow input (keyboard and mouse)
  // - shared=true: allow multiple connections
  // - reconnect=true: automatically reconnect if disconnected
  // Note: websockify with --web serves noVNC files and proxies /websockify to localhost:5900
  return `${base}/vnc.html?host=${publicIp}&port=${VNC_NOVNC_PORT}&path=websockify&encrypt=0&autoconnect=true&resize=remote&view_only=false&shared=true&reconnect=true`;
}

function requireConfig(res) {
  if (!VNC_INSTANCE_ID) {
    res.status(500).json({ error: 'VNC_INSTANCE_ID is not configured' });
    return false;
  }
  if (!VNC_SSH_KEY_PATH) {
    res.status(500).json({ error: 'VNC_SSH_KEY_PATH is not configured' });
    return false;
  }
  if (!VNC_CALLBACK_URL) {
    res.status(500).json({ error: 'VNC_CALLBACK_URL is not configured' });
    return false;
  }
  return true;
}

async function startRemoteLogin(sessionToken, callbackUrl, publicIp) {
  // Build environment variables as shell export statements
  const envVars = [
    `SESSION_TOKEN=${sessionToken}`,
    `CALLBACK_URL=${callbackUrl}`,
    `LOGIN_TIMEOUT_MS=${VNC_LOGIN_TIMEOUT_MS}`,
    'DISPLAY=:99'
  ].join(' ');

  // Use the full path to Node 16 directly, avoiding nvm sourcing issues
  // Log to /tmp which is writable by all users
  const nodeCmd = '/home/ec2-user/.nvm/versions/node/v16.20.2/bin/node';
  const cmd = `${envVars} ${nodeCmd} ${VNC_REMOTE_SCRIPT_PATH} >> /tmp/vnc-login-${sessionToken}.log 2>&1 &`;
  
  // Temporarily set AWS_SSH_USER for executeCommand
  const originalSshUser = process.env.AWS_SSH_USER;
  process.env.AWS_SSH_USER = VNC_SSH_USER;
  
  try {
    const result = await executeCommand(publicIp, cmd, VNC_SSH_KEY_PATH, VNC_LOGIN_TIMEOUT_MS + 60000);
    if (!result.success) {
      throw new Error(result.error || 'Failed to start remote login script');
    }
    return true;
  } finally {
    // Restore original SSH user
    if (originalSshUser !== undefined) {
      process.env.AWS_SSH_USER = originalSshUser;
    } else {
      delete process.env.AWS_SSH_USER;
    }
  }
}

router.post('/start-session', async (req, res) => {
  if (!requireConfig(res)) return;

  try {
    // Cleanup expired sessions opportunistically
    sessionManager.cleanupExpired();

    // Ensure EC2 is up
    // Temporarily set AWS_SSH_USER for ensureInstanceReady
    const originalSshUser = process.env.AWS_SSH_USER;
    process.env.AWS_SSH_USER = VNC_SSH_USER;
    
    let readiness;
    try {
      readiness = await ensureInstanceReady(VNC_INSTANCE_ID, VNC_INSTANCE_IP, VNC_SSH_KEY_PATH);
    } finally {
      // Restore original SSH user
      if (originalSshUser !== undefined) {
        process.env.AWS_SSH_USER = originalSshUser;
      } else {
        delete process.env.AWS_SSH_USER;
      }
    }
    
    if (!readiness.success) {
      return res.status(500).json({ error: readiness.error || 'Failed to start VNC instance' });
    }

    const publicIp = readiness.publicIp;
    const session = sessionManager.createSession({
      vncUrl: null,
      callbackUrl: VNC_CALLBACK_URL
    });

    const vncUrl = buildNoVncUrl(publicIp, session.sessionToken);
    session.vncUrl = vncUrl;

    // Kick off remote login script via SSH
    await startRemoteLogin(session.sessionToken, VNC_CALLBACK_URL, publicIp);
    sessionManager.markActive(session.sessionToken);

    res.json({
      sessionToken: session.sessionToken,
      vncUrl,
      publicIp
    });
  } catch (err) {
    console.error('❌ start-session error:', err.message);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
});

router.get('/session/:token/status', (req, res) => {
  // Only cleanup expired sessions occasionally (not on every status check)
  // This prevents premature cleanup of active sessions
  if (Math.random() < 0.1) { // 10% chance to cleanup on each request
    sessionManager.cleanupExpired();
  }
  
  const session = sessionManager.getSession(req.params.token);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  res.json(session);
});

router.post('/session/:token/cancel', (req, res) => {
  const session = sessionManager.cancelSession(req.params.token);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ status: session.status, sessionToken: session.sessionToken });
});

router.post('/callback', express.json(), async (req, res) => {
  const { sessionToken, cookies, username, metadata, error } = req.body || {};
  if (!sessionToken) {
    return res.status(400).json({ error: 'sessionToken is required' });
  }

  const session = sessionManager.getSession(sessionToken);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (error) {
    console.error(`❌ Session ${sessionToken} failed: ${error}`);
    sessionManager.failSession(sessionToken, error);
  } else {
    // Validate cookies before completing session
    console.log(`📥 Received callback for session ${sessionToken}`);
    console.log(`   Cookies: ${cookies?.length || 0}`);
    console.log(`   Username: ${username || 'not provided'}`);
    
    if (!cookies || !Array.isArray(cookies) || cookies.length === 0) {
      const errorMsg = 'No cookies provided in callback';
      console.error(`❌ ${errorMsg}`);
      sessionManager.failSession(sessionToken, errorMsg);
      return res.status(400).json({ error: errorMsg });
    }
    
    // Validate cookies using same logic as canvas-crawler.js
    const hasSessionCookie = cookies.some(c => 
      c.name && (c.name.includes('session') || c.name.includes('canvas') || c.name.includes('_session'))
    );
    
    const hasAuthCookie = cookies.some(c => 
      c.domain && (c.domain.includes('canvas') || c.domain.includes('colorado.edu') || c.domain.includes('instructure.com'))
    );
    
    if (!hasSessionCookie && !hasAuthCookie) {
      const errorMsg = 'No valid Canvas authentication cookies found';
      console.error(`❌ ${errorMsg}`);
      console.error(`   - Has session cookie: ${hasSessionCookie}`);
      console.error(`   - Has auth cookie: ${hasAuthCookie}`);
      console.error(`   - Cookie names: ${cookies.map(c => c.name).join(', ')}`);
      console.error(`   - Cookie domains: ${cookies.map(c => c.domain).join(', ')}`);
      sessionManager.failSession(sessionToken, errorMsg);
      return res.status(400).json({ error: errorMsg });
    }
    
    console.log(`✅ Cookie validation passed:`);
    console.log(`   - Has session cookie: ${hasSessionCookie}`);
    console.log(`   - Has auth cookie: ${hasAuthCookie}`);
    console.log(`   - Total cookies: ${cookies.length}`);
    
    sessionManager.completeSession(sessionToken, { cookies, username, metadata });
    
    // Stop the EC2 instance after successful cookie extraction
    if (VNC_INSTANCE_ID) {
      console.log(`🛑 Stopping EC2 instance ${VNC_INSTANCE_ID} after successful cookie extraction...`);
      try {
        const stopResult = await stopInstance(VNC_INSTANCE_ID);
        if (stopResult.success) {
          console.log(`✅ EC2 instance ${VNC_INSTANCE_ID} stopped successfully`);
        } else {
          console.error(`⚠️  Failed to stop EC2 instance: ${stopResult.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error(`❌ Error stopping EC2 instance: ${err.message}`);
        // Don't fail the callback - cookies are already extracted
      }
    }
  }

  res.json({ ok: true });
});

module.exports = router;

