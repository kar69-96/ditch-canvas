/**
 * Device identification utilities for device-based authentication
 * Used to verify that auto-login requests come from trusted devices
 */

const DEVICE_ID_KEY = "canvas_device_id";

/**
 * Get or generate a unique device identifier
 * The device ID is a UUID stored in localStorage, persistent across sessions
 * @returns The device ID for this browser
 */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * Generate a hash of browser characteristics for secondary validation
 * This hash changes if the user's browser, OS, or screen configuration changes significantly
 * It's used as a soft validation - if it mismatches, user just sees Canvas popup (not locked out)
 * @returns SHA-256 hash of browser characteristics
 */
export async function getBrowserHash(): Promise<string> {
  const characteristics = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
  };

  const data = new TextEncoder().encode(JSON.stringify(characteristics));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Clear the device ID from localStorage
 * Typically called when the user explicitly logs out and wants to be treated as a new device
 * Note: This is optional - most logouts should NOT clear device ID,
 * only use when user wants to revoke device trust
 */
export function clearDeviceId(): void {
  localStorage.removeItem(DEVICE_ID_KEY);
}

/**
 * Check if a device ID exists in localStorage
 * @returns true if this browser has a stored device ID
 */
export function hasDeviceId(): boolean {
  return localStorage.getItem(DEVICE_ID_KEY) !== null;
}
