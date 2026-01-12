/**
 * User Database Service
 *
 * Uses backend API (with service key) to access Supabase users table.
 * The backend bypasses RLS, so this works with anon key restrictions.
 */

import type { User } from '@/services/mockApi/types';

// API base URL
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Convert Supabase row (snake_case) to User type (camelCase)
 */
function supabaseRowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    student: row.student,
    school: row.school,
    canvasCookies: row.canvas_cookies,
    canvasCookiesUpdatedAt: row.canvas_cookies_updated_at,
    lastLoginAt: row.last_login_at,
    inviteCodeUsed: row.invite_code_used,
    onboardingCompletedAt: row.onboarding_completed_at,
    profilePreferences: row.profile_preferences || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert User type (camelCase) to Supabase format (snake_case)
 */
function userToSupabaseRow(user: Partial<User>): any {
  const row: any = {};
  if (user.id !== undefined) row.id = user.id;
  if (user.email !== undefined) row.email = user.email?.toLowerCase().trim();
  if (user.firstName !== undefined) row.first_name = user.firstName;
  if (user.student !== undefined) row.student = user.student;
  if (user.school !== undefined) row.school = user.school;
  if (user.canvasCookies !== undefined) row.canvas_cookies = user.canvasCookies;
  if (user.canvasCookiesUpdatedAt !== undefined) row.canvas_cookies_updated_at = user.canvasCookiesUpdatedAt;
  if (user.lastLoginAt !== undefined) row.last_login_at = user.lastLoginAt;
  if (user.inviteCodeUsed !== undefined) row.invite_code_used = user.inviteCodeUsed;
  if (user.onboardingCompletedAt !== undefined) row.onboarding_completed_at = user.onboardingCompletedAt;
  if (user.profilePreferences !== undefined) row.profile_preferences = user.profilePreferences;
  return row;
}

export const userDatabase = {
  /**
   * Get user by UUID (via backend API)
   */
  async getUser(userId: string): Promise<User | null> {
    try {
      const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 404) return null;
        console.error('[userDatabase] Error getting user:', data.error);
        return null;
      }

      return data.user ? supabaseRowToUser(data.user) : null;
    } catch (error) {
      console.error('[userDatabase] Exception getting user:', error);
      return null;
    }
  },

  /**
   * Get user by email (via backend API)
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(normalizedEmail)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 404) return null;
        console.error('[userDatabase] Error getting user by email:', data.error);
        return null;
      }

      return data.user ? supabaseRowToUser(data.user) : null;
    } catch (error) {
      console.error('[userDatabase] Exception getting user by email:', error);
      return null;
    }
  },

  /**
   * Get user by student identikey
   */
  async getUserByStudent(student: string): Promise<User | null> {
    // Not implemented via API - rarely used
    console.warn('[userDatabase] getUserByStudent not implemented via API');
    return null;
  },

  /**
   * Update an existing user (via backend API)
   */
  async updateUser(userId: string, updates: Partial<User>): Promise<User | null> {
    try {
      const updateData = userToSupabaseRow(updates);

      const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error('[userDatabase] Error updating user:', data.error);
        return null;
      }

      return data.user ? supabaseRowToUser(data.user) : null;
    } catch (error) {
      console.error('[userDatabase] Exception updating user:', error);
      return null;
    }
  },

  /**
   * Update user's last login timestamp (via backend API)
   */
  async updateLastLogin(userId: string): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/last-login`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        console.error('[userDatabase] Error updating last login:', data.error);
        return;
      }

      console.log('[userDatabase] Last login updated successfully');
    } catch (error) {
      console.error('[userDatabase] Exception updating last login:', error);
    }
  },

  /**
   * Check if user exists by email
   */
  async userExists(email: string): Promise<boolean> {
    const user = await this.getUserByEmail(email);
    return user !== null;
  },
};
