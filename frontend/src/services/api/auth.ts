const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function handleResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  // Allow pending status to pass through without throwing error
  if (!response.ok || (data?.success === false && !data?.pending)) {
    const message = data?.error || data?.message || `Request failed with status ${response.status}`;
    console.error('[API] Request failed:', {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      data
    });
    throw new Error(message);
  }
  return data;
}

export async function authenticateWithCanvas(email?: string) {
  const res = await fetch(`${API_BASE}/api/auth/canvas/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function loginWithCanvas(email: string) {
  const res = await fetch(`${API_BASE}/api/auth/canvas/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function checkAuthStatus(sessionToken: string) {
  const res = await fetch(`${API_BASE}/api/auth/canvas/status/${sessionToken}`);
  return handleResponse(res);
}

export async function releaseAuthSession(sessionToken: string) {
  const res = await fetch(`${API_BASE}/api/auth/canvas/release/${sessionToken}`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function checkEmailExists(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/check-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function startStreamingAuth(email: string) {
  try {
    // Check if we need to force re-authentication (e.g., after logout)
    const forceReauth = localStorage.getItem('canvas_force_reauth') === 'true';
    
    console.log('[API] Starting streaming auth:', { email, forceReauth, url: `${API_BASE}/api/streaming-auth/start` });
    
    const res = await fetch(`${API_BASE}/api/streaming-auth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, forceReauth }),
    });
    
    // Clear the flag after starting auth (it will be handled by backend)
    if (forceReauth) {
      localStorage.removeItem('canvas_force_reauth');
    }
    
    return handleResponse(res);
  } catch (error: any) {
    console.error('[API] Failed to start streaming auth:', error);
    throw new Error(`Failed to initiate Canvas login: ${error.message}`);
  }
}

export async function stopStreamingAuth(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function getExtractionResult(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/extraction-result/${encodeURIComponent(email)}`);
  return handleResponse(res);
}

export async function verifyLogin(email: string, username: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/verify-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username }),
  });
  return handleResponse(res);
}

export async function deleteCookies(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/cookies/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
  return handleResponse(res);
}
