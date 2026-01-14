const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

async function handleResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    const message =
      data?.error ||
      data?.message ||
      `Request failed with status ${response.status}`;
    console.error("[Settings API] Request failed:", {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      data,
    });
    throw new Error(message);
  }
  return data;
}

/**
 * Delete user account and all associated data
 */
export async function deleteAccount(userId: string, email: string) {
  const res = await fetch(
    `${API_BASE}/api/users/${userId}?email=${encodeURIComponent(email)}`,
    {
      method: "DELETE",
    },
  );
  return handleResponse(res);
}
