import { getCurrentUser } from "../mockApi/auth";

const API_BASE =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "http://localhost:3000/api";

async function ensureUserEmail(): Promise<string> {
  const user = await getCurrentUser();
  if (!user?.email) {
    throw new Error("No user email available");
  }
  return user.email;
}

export async function listIntegrations() {
  const email = await ensureUserEmail();
  console.log('[listIntegrations] Fetching integrations for email:', email);
  const res = await fetch(`${API_BASE}/integrations?userEmail=${encodeURIComponent(email)}`);
  if (!res.ok) {
    throw new Error(`Failed to load integrations: ${res.statusText}`);
  }
  const data = await res.json();
  console.log('[listIntegrations] API response:', data);
  const integrations = data.integrations ?? [];
  console.log('[listIntegrations] Returning integrations:', integrations);
  return integrations;
}

export async function connectIntegration(provider: "google" | "notion") {
  try {
    const email = await ensureUserEmail();
    console.log('[connectIntegration] Connecting', provider, 'for email:', email);
    console.log('[connectIntegration] API_BASE:', API_BASE);
    
    const res = await fetch(`${API_BASE}/integrations/${provider}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userEmail: email }),
    });
    
    console.log('[connectIntegration] Response status:', res.status, res.statusText);
    
    if (!res.ok) {
      const text = await res.text();
      console.error('[connectIntegration] Error response:', text);
      throw new Error(`Failed to start ${provider} auth: ${text}`);
    }
    
    const data = await res.json();
    console.log('[connectIntegration] Success, authUrl:', data.authUrl?.substring(0, 50) + '...');
    return data.authUrl as string;
  } catch (error) {
    console.error('[connectIntegration] Fetch error:', error);
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error(`Cannot connect to backend server. Make sure the backend is running on ${API_BASE}`);
    }
    throw error;
  }
}

export async function disconnectIntegration(provider: "google" | "notion") {
  const email = await ensureUserEmail();
  const res = await fetch(`${API_BASE}/integrations/${provider}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userEmail: email }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to disconnect ${provider}: ${text}`);
  }
  return true;
}

export async function syncIntegration(provider: "google" | "notion") {
  const email = await ensureUserEmail();
  
  // Completion status is now stored in Supabase (single source of truth)
  // No need to send completedAssignmentIds - sync will read from Supabase
  
  const res = await fetch(`${API_BASE}/integrations/${provider}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      userEmail: email,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to sync ${provider}: ${text}`);
  }
  const data = await res.json();
  return data;
}

