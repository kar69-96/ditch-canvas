const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function handleResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    const message = data?.error || data?.message || 'Request failed';
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
