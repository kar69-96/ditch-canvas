/**
 * Device trust API service
 * Handles checking and registering trusted devices for auto-login security
 */

// Use relative URLs for production (empty API_BASE means same-origin requests)
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export interface DeviceTrustCheckResult {
  success: boolean;
  trusted: boolean;
  reason?: string;
  error?: string;
}

export interface DeviceTrustResult {
  success: boolean;
  error?: string;
}

/**
 * Check if a device is trusted for auto-login
 * A device is trusted if it successfully completed Canvas popup authentication
 * within the last 24 hours on this specific browser/device
 *
 * @param email - User email
 * @param deviceId - Device ID from localStorage
 * @param deviceHash - Browser characteristics hash
 * @returns Trust check result with reason if not trusted
 */
export async function checkDeviceTrust(
  email: string,
  deviceId: string,
  deviceHash: string,
): Promise<DeviceTrustCheckResult> {
  try {
    const response = await fetch(
      `${API_BASE}/api/streaming-auth/check-device-trust`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          device_id: deviceId,
          device_hash: deviceHash,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.warn("[DeviceTrust] Check failed:", data);
      return {
        success: false,
        trusted: false,
        error: data.error || "Failed to check device trust",
      };
    }

    return data;
  } catch (error: any) {
    console.error("[DeviceTrust] Error checking device trust:", error);
    // On error, treat as untrusted (user will just see Canvas popup)
    return {
      success: false,
      trusted: false,
      error: error.message || "Network error",
    };
  }
}

/**
 * Register a device as trusted after successful Canvas popup authentication
 * Called after the user successfully completes the Canvas login popup
 *
 * @param email - User email
 * @param deviceId - Device ID from localStorage
 * @param deviceHash - Browser characteristics hash
 * @param userAgent - Browser user agent string
 * @returns Trust registration result
 */
export async function trustDevice(
  email: string,
  deviceId: string,
  deviceHash: string,
  userAgent: string,
): Promise<DeviceTrustResult> {
  try {
    const response = await fetch(
      `${API_BASE}/api/streaming-auth/trust-device`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          device_id: deviceId,
          device_hash: deviceHash,
          user_agent: userAgent,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.warn("[DeviceTrust] Trust registration failed:", data);
      return {
        success: false,
        error: data.error || "Failed to register device trust",
      };
    }

    return data;
  } catch (error: any) {
    console.error("[DeviceTrust] Error registering device trust:", error);
    // Don't throw - device trust is a security enhancement, not critical for login
    return {
      success: false,
      error: error.message || "Network error",
    };
  }
}

/**
 * Revoke trust for a device (e.g., on explicit logout request)
 * This is optional - normal logout doesn't need to revoke device trust
 *
 * @param email - User email
 * @param deviceId - Device ID from localStorage
 * @returns Revocation result
 */
export async function revokeDeviceTrust(
  email: string,
  deviceId: string,
): Promise<DeviceTrustResult> {
  try {
    const response = await fetch(
      `${API_BASE}/api/streaming-auth/revoke-device-trust`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          device_id: deviceId,
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.warn("[DeviceTrust] Trust revocation failed:", data);
      return {
        success: false,
        error: data.error || "Failed to revoke device trust",
      };
    }

    return data;
  } catch (error: any) {
    console.error("[DeviceTrust] Error revoking device trust:", error);
    return {
      success: false,
      error: error.message || "Network error",
    };
  }
}
