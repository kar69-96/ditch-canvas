// Use relative URLs for production (empty API_BASE means same-origin requests)
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function handleResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  // Allow pending status and queued (202) status to pass through without throwing error
  if (
    !response.ok &&
    response.status !== 202 &&
    data?.success === false &&
    !data?.pending &&
    !data?.queued
  ) {
    const message =
      data?.error ||
      data?.message ||
      `Request failed with status ${response.status}`;
    console.error("[API] Request failed:", {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      data,
    });
    throw new Error(message);
  }
  return data;
}

export async function checkEmailExists(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/check-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function startStreamingAuth(
  email: string,
  context: "login" | "onboarding" = "login",
) {
  try {
    // Check if we need to force re-authentication (e.g., after logout)
    const forceReauth = localStorage.getItem("canvas_force_reauth") === "true";

    const apiUrl = `${API_BASE}/api/streaming-auth/start`;
    console.log("[API] Starting streaming auth:", {
      email,
      forceReauth,
      context,
      url: apiUrl,
      API_BASE,
    });

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, forceReauth, context }),
    });

    // Clear the flag after starting auth (it will be handled by backend)
    if (forceReauth) {
      localStorage.removeItem("canvas_force_reauth");
    }

    return handleResponse(res);
  } catch (error: any) {
    console.error("[API] Failed to start streaming auth:", error);

    // Provide more helpful error messages
    let errorMessage = error.message || "Unknown error";

    // Check for common network errors
    if (
      error.message?.includes("Failed to fetch") ||
      error.message?.includes("NetworkError")
    ) {
      const backendUrl = API_BASE || window.location.origin;
      errorMessage = `Cannot connect to backend server at ${backendUrl}. Please ensure the backend server is running.`;
    } else if (error.message?.includes("CORS")) {
      errorMessage =
        "CORS error: The backend server may not be configured to allow requests from this origin.";
    }

    throw new Error(`Failed to initiate Canvas login: ${errorMessage}`);
  }
}

export async function stopStreamingAuth(email: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function getExtractionResult(
  email: string,
  streamingServerUrl?: string,
  sessionId?: string,
) {
  // For EC2 streaming servers with sessionId, use session-based endpoint
  // For legacy/fallback, use email-based endpoint
  const isEC2 =
    streamingServerUrl &&
    (streamingServerUrl.includes("trycloudflare.com") ||
      streamingServerUrl.includes("login.ditchcanvas.com"));

  let url: string;
  if (isEC2 && sessionId) {
    // New multi-session endpoint - uses sessionId
    url = `${streamingServerUrl}/extraction-result/${encodeURIComponent(sessionId)}`;
  } else if (isEC2) {
    // Legacy email-based endpoint for backwards compatibility
    url = `${streamingServerUrl}/extraction-result-legacy/${encodeURIComponent(email)}`;
  } else {
    // Local development - use API path with email
    url = `${API_BASE}/api/streaming-auth/extraction-result/${encodeURIComponent(email)}`;
  }

  const res = await fetch(url);
  return handleResponse(res);
}

export async function verifyLogin(email: string, username: string) {
  const res = await fetch(`${API_BASE}/api/streaming-auth/verify-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username }),
  });
  return handleResponse(res);
}

/**
 * Save cookies to Supabase
 * Called by frontend after successful extraction from EC2 streaming server
 * This is needed because EC2 doesn't have Supabase credentials
 */
export async function saveCookiesToSupabase(email: string, cookies: any[]) {
  try {
    const res = await fetch(`${API_BASE}/api/streaming-auth/save-cookies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, cookies }),
    });
    return handleResponse(res);
  } catch (error: any) {
    console.error("[API] Failed to save cookies to Supabase:", error);
    // Don't throw - this is non-critical, login can proceed
    return { success: false, error: error.message };
  }
}

export async function deleteCookies(email: string) {
  const res = await fetch(
    `${API_BASE}/api/streaming-auth/cookies/${encodeURIComponent(email)}`,
    {
      method: "DELETE",
    },
  );
  return handleResponse(res);
}

/**
 * Trigger background Canvas data update
 * Runs after login to sync latest Canvas data
 */
export async function startBackgroundUpdate(email: string) {
  try {
    const res = await fetch(`${API_BASE}/api/update/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  } catch (error: any) {
    console.error("[API] Failed to start background update:", error);
    // Don't throw - update is non-blocking, user can still use the app
    return { success: false, error: error.message };
  }
}

/**
 * Check status of background update
 */
export async function getUpdateStatus(email: string) {
  try {
    const res = await fetch(
      `${API_BASE}/api/update/status/${encodeURIComponent(email)}`,
    );
    return handleResponse(res);
  } catch (error: any) {
    console.error("[API] Failed to get update status:", error);
    return { hasActiveUpdate: false, error: error.message };
  }
}

// =============================================================================
// EC2 Manager / Queue Management
// =============================================================================

export interface StreamingAuthResult {
  success: boolean;
  url?: string;
  streamingServerUrl?: string;
  sessionId?: string;
  instanceId?: string;
  requestId?: string;
  message?: string;
  // Queue information (when request is queued)
  queued?: boolean;
  position?: number;
  estimatedWaitSeconds?: number;
}

export interface QueueStatusResult {
  success: boolean;
  status:
    | "pending"
    | "assigned"
    | "in_progress"
    | "completed"
    | "failed"
    | "timeout";
  tunnelUrl?: string;
  sessionId?: string;
  instanceId?: string;
  position?: number;
  estimatedWaitSeconds?: number;
  error?: string;
}

/**
 * Get queue status for a pending auth request
 * Used when startStreamingAuth returns a queued response
 *
 * @param requestId - Request ID from startStreamingAuth
 * @returns Queue status with tunnel URL when assigned
 */
export async function getQueueStatus(
  requestId: string,
): Promise<QueueStatusResult> {
  try {
    const res = await fetch(
      `${API_BASE}/api/ec2-manager/status/${encodeURIComponent(requestId)}`,
    );
    return handleResponse(res);
  } catch (error: any) {
    console.error("[API] Failed to get queue status:", error);
    return { success: false, status: "failed", error: error.message };
  }
}

/**
 * Poll for queue status until assigned or timeout
 *
 * @param requestId - Request ID from startStreamingAuth
 * @param onStatusUpdate - Callback for status updates
 * @param maxWaitMs - Maximum wait time (default 2 minutes)
 * @param pollIntervalMs - Poll interval (default 2 seconds)
 * @returns Final status with tunnel URL when assigned
 */
export async function pollQueueStatus(
  requestId: string,
  onStatusUpdate?: (status: QueueStatusResult) => void,
  maxWaitMs = 120000,
  pollIntervalMs = 2000,
): Promise<QueueStatusResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getQueueStatus(requestId);

    if (onStatusUpdate) {
      onStatusUpdate(status);
    }

    // If assigned, return the tunnel URL
    if (status.status === "assigned" && status.tunnelUrl) {
      console.log(
        "[API] Queue request assigned to instance:",
        status.instanceId,
      );
      return status;
    }

    // If failed or completed, return immediately
    if (
      status.status === "failed" ||
      status.status === "timeout" ||
      status.status === "completed"
    ) {
      console.warn("[API] Queue request ended with status:", status.status);
      return status;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout
  console.warn("[API] Queue polling timed out");
  return {
    success: false,
    status: "timeout",
    error: "Queue polling timed out",
  };
}

/**
 * Release a session when auth completes (for cleanup)
 *
 * @param requestId - Request ID from startStreamingAuth
 * @param status - "completed" or "failed"
 */
export async function releaseAuthSession(
  requestId: string,
  status: "completed" | "failed" = "completed",
) {
  try {
    const res = await fetch(`${API_BASE}/api/ec2-manager/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, status }),
    });
    return handleResponse(res);
  } catch (error: any) {
    console.error("[API] Failed to release auth session:", error);
    // Non-critical, don't throw
    return { success: false, error: error.message };
  }
}
