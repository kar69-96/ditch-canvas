/**
 * Session storage service - localStorage-based for reliability
 * Supabase tables may not exist, so we use localStorage as primary storage
 */

export interface SessionData {
  token: string;
  userId: string;  // UUID string (not number)
  expiresAt: number;
  email?: string; // Store email for reliable lookup
}

// Keys for localStorage
const SESSION_KEY = 'canvas_session';
const USER_EMAIL_KEY = 'canvas_user_email';

function getLocalStorageSession(): SessionData | null {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    if (!data) return null;
    
    const session = JSON.parse(data) as SessionData;
    
    // Check if expired
    if (session.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(USER_EMAIL_KEY);
      return null;
    }
    
    return session;
  } catch {
    return null;
  }
}

export const sessionStorage = {
  /**
   * Get session from localStorage
   */
  async getSession(): Promise<SessionData | null> {
    return getLocalStorageSession();
  },

  /**
   * Get user email from session
   */
  getEmail(): string | null {
    const session = getLocalStorageSession();
    if (session?.email) return session.email;
    return localStorage.getItem(USER_EMAIL_KEY);
  },

  /**
   * Set/create session with email
   */
  async setSession(userId: string, expiresInDays: number = 7, email?: string): Promise<SessionData> {
    // Clear any existing session first
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_EMAIL_KEY);
    
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
    const token = `session_${userId}_${Date.now()}`;
    
    const sessionData: SessionData = {
      token,
      userId,
      expiresAt,
      email,
    };
    
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    if (email) {
      localStorage.setItem(USER_EMAIL_KEY, email);
    }
    
    console.log('[sessionStorage] Session set:', { userId, email, expiresAt: new Date(expiresAt).toISOString() });
    
    return sessionData;
  },

  /**
   * Clear session
   */
  async clearSession(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_EMAIL_KEY);
    console.log('[sessionStorage] Session cleared');
  },

  /**
   * Check if session is valid
   */
  async hasValidSession(): Promise<boolean> {
    const session = getLocalStorageSession();
    return session !== null;
  },
};
