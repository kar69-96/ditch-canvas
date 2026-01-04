// Default to localhost:3000 in development if VITE_API_BASE_URL is not set
const API_BASE = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.DEV ? 'http://localhost:3000' : '');

async function handleResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || `Request failed with status ${response.status}`;
    console.error('[Onboarding API] Request failed:', {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      data
    });
    throw new Error(message);
  }
  return data;
}

export interface PersonalInfo {
  firstName: string;
  school: string;
  email: string;
}

export interface PersonalInfoResponse {
  success: boolean;
  validSchool?: boolean;
  message?: string;
  data?: PersonalInfo;
  error?: string;
}

export interface InviteCodeValidationResponse {
  success: boolean;
  valid?: boolean;
  error?: string;
  data?: {
    code: string;
    maxUsers: number;
    currentUsers: number;
  };
}

export interface WaitlistResponse {
  success: boolean;
  message?: string;
  alreadyExists?: boolean;
  data?: {
    id: string;
    first_name: string;
    school: string;
    email: string;
    created_at: string;
  };
  error?: string;
}

export interface SyncResponse {
  success: boolean;
  message?: string;
  data?: {
    identikey: string;
    email: string;
  };
  error?: string;
}

export interface CompleteResponse {
  success: boolean;
  message?: string;
  data?: {
    userId: string;
    email: string;
  };
  error?: string;
}

/**
 * Submit personal information (Step 1)
 */
export async function submitPersonalInfo(data: PersonalInfo): Promise<PersonalInfoResponse> {
  try {
    const url = `${API_BASE}/api/onboarding/personal-info`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  } catch (error: any) {
    console.error('[Onboarding API] Network error:', error);
    if (error.message?.includes('Failed to fetch') || error.message?.includes('Could not connect')) {
      throw new Error(`Cannot connect to backend server at ${API_BASE || 'http://localhost:3000'}. Please ensure the backend server is running.`);
    }
    throw error;
  }
}

/**
 * Validate invite code (Step 2)
 */
export async function validateInviteCode(inviteCode: string): Promise<InviteCodeValidationResponse> {
  const res = await fetch(`${API_BASE}/api/onboarding/validate-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode }),
  });
  return handleResponse(res);
}

/**
 * Join waitlist
 */
export async function joinWaitlist(data: PersonalInfo): Promise<WaitlistResponse> {
  const res = await fetch(`${API_BASE}/api/onboarding/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

/**
 * Submit identikey and prepare for sync (Step 3)
 */
export async function submitIdentikey(
  identikey: string,
  email: string,
  firstName: string,
  school: string,
  inviteCode: string
): Promise<SyncResponse> {
  const res = await fetch(`${API_BASE}/api/onboarding/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identikey,
      email,
      firstName,
      school,
      inviteCode,
    }),
  });
  return handleResponse(res);
}

/**
 * Complete onboarding - create user account (after cookie extraction)
 */
export async function completeOnboarding(
  email: string,
  firstName: string,
  school: string,
  inviteCode: string,
  identikey?: string
): Promise<CompleteResponse> {
  const res = await fetch(`${API_BASE}/api/onboarding/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      firstName,
      school,
      inviteCode,
      identikey,
    }),
  });
  return handleResponse(res);
}

