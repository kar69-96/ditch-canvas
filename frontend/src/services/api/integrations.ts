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
  const res = await fetch(`${API_BASE}/integrations?userEmail=${encodeURIComponent(email)}`);
  if (!res.ok) {
    throw new Error(`Failed to load integrations: ${res.statusText}`);
  }
  const data = await res.json();
  return data.integrations ?? [];
}

export async function connectIntegration(provider: "google" | "notion") {
  const email = await ensureUserEmail();
  const res = await fetch(`${API_BASE}/integrations/${provider}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userEmail: email }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to start ${provider} auth: ${text}`);
  }
  const data = await res.json();
  return data.authUrl as string;
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
  
  // Get completed assignment IDs from localStorage
  const completedAssignmentsStr = localStorage.getItem('completedAssignments');
  const completedAssignmentIds = completedAssignmentsStr 
    ? JSON.parse(completedAssignmentsStr) 
    : [];
  
  const res = await fetch(`${API_BASE}/integrations/${provider}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ 
      userEmail: email,
      completedAssignmentIds: completedAssignmentIds,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to sync ${provider}: ${text}`);
  }
  const data = await res.json();
  return data;
}

