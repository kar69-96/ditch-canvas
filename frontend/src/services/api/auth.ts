// Use relative URLs for production (empty API_BASE means same-origin requests)
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

export async function checkEmailExists(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/check-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function startStreamingAuth(email: string, context: 'login' | 'onboarding' = 'login') {
  try {
  // Check if we need to force re-authentication (e.g., after logout)
  const forceReauth = localStorage.getItem('canvas_force_reauth') === 'true';
    
    const apiUrl = `${API_BASE}/api/streaming-auth/start`;
    console.log('[API] Starting streaming auth:', { email, forceReauth, context, url: apiUrl, API_BASE });
  
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, forceReauth, context }),
  });
  
  // Clear the flag after starting auth (it will be handled by backend)
  if (forceReauth) {
    localStorage.removeItem('canvas_force_reauth');
  }
  
  return handleResponse(res);
  } catch (error: any) {
    console.error('[API] Failed to start streaming auth:', error);
    
    // Provide more helpful error messages
    let errorMessage = error.message || 'Unknown error';
    
    // Check for common network errors
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      const backendUrl = API_BASE || window.location.origin;
      errorMessage = `Cannot connect to backend server at ${backendUrl}. Please ensure the backend server is running.`;
    } else if (error.message?.includes('CORS')) {
      errorMessage = 'CORS error: The backend server may not be configured to allow requests from this origin.';
    }
    
    throw new Error(`Failed to initiate Canvas login: ${errorMessage}`);
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

export async function getExtractionResult(email: string, streamingServerUrl?: string) {
  // Use streaming server URL directly if provided (for EC2), otherwise use API_BASE (legacy)
  const url = streamingServerUrl
    ? `${streamingServerUrl}/extraction-result/${encodeURIComponent(email)}`
    : `${API_BASE}/api/streaming-auth/extraction-result/${encodeURIComponent(email)}`;

  const res = await fetch(url);
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

/**
 * Trigger background Canvas data update
 * Runs after login to sync latest Canvas data
 */
export async function startBackgroundUpdate(email: string) {
  try {
    const res = await fetch(`${API_BASE}/api/update/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  } catch (error: any) {
    console.error('[API] Failed to start background update:', error);
    // Don't throw - update is non-blocking, user can still use the app
    return { success: false, error: error.message };
  }
}

/**
 * Check status of background update
 */
export async function getUpdateStatus(email: string) {
  try {
    const res = await fetch(`${API_BASE}/api/update/status/${encodeURIComponent(email)}`);
    return handleResponse(res);
  } catch (error: any) {
    console.error('[API] Failed to get update status:', error);
    return { hasActiveUpdate: false, error: error.message };
  }
}
