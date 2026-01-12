/**
 * Auth API using localStorage
 * User data is stored in localStorage during login (from backend with service key)
 * Supabase queries with anon key are blocked by RLS, so we use localStorage
 */

import { sessionStorage } from '@/storage/session';
import { userStorage } from '@/storage/user';
import { clearCacheForUser } from '@/services/api/canvasApi';
import type { User } from './types';

/**
 * Check if a valid session exists
 * Uses localStorage for user lookup (user data saved during login)
 */
export async function checkSession(): Promise<{ userId: string; user: User } | null> {
  try {
    const session = await sessionStorage.getSession();
    if (!session) {
      return null;
    }

    const isValid = await sessionStorage.hasValidSession();
    if (!isValid) {
      await sessionStorage.clearSession();
      return null;
    }

    // Get user from localStorage (saved during login from backend)
    let user: User | null = await userStorage.getUser(session.userId);

    // Try by email if not found by ID
    if (!user && session.email) {
      user = await userStorage.getUserByEmail(session.email);
    }

    if (!user) {
      console.warn('[auth] User not found in localStorage for session');
      await sessionStorage.clearSession();
      return null;
    }

    return {
      userId: session.userId,
      user,
    };
  } catch (error) {
    console.error('[auth] Error checking session:', error);
    return null;
  }
}

/**
 * Logout - clear session and all cached data
 * This ensures that when logging back in, the user must re-authenticate with Canvas
 */
export async function logout(): Promise<void> {
  try {
    // Get user info before clearing session
    const session = await sessionStorage.getSession();
    const userEmail = session?.email || sessionStorage.getEmail();
    const userId = session?.userId;

    // Delete cookies on backend if we have an email
    if (userEmail) {
      try {
        const { deleteCookies } = await import('@/services/api/auth');
        await deleteCookies(userEmail);
        console.log('[auth] Deleted cookies for user:', userEmail);
      } catch (cookieError) {
        console.error('[auth] Error deleting cookies:', cookieError);
        // Continue with logout even if cookie deletion fails
      }
    }

    // Set flag to force re-authentication on next login
    localStorage.setItem('canvas_force_reauth', 'true');

    // Clear session
    await sessionStorage.clearSession();

    // Clear user from localStorage
    if (userId) {
      await userStorage.deleteUser(userId);
      console.log('[auth] Deleted user from localStorage:', userId);
    }

    // Clear Canvas API cache for this user
    if (userEmail) {
      clearCacheForUser(userEmail);
      console.log('[auth] Cleared cache for user:', userEmail);
    }

    console.log('[auth] Logout complete - all session data and cookies cleared, re-auth required');
  } catch (error) {
    console.error('[auth] Error in logout:', error);
    // Still try to clear session even if other operations fail
    try {
      await sessionStorage.clearSession();
      localStorage.setItem('canvas_force_reauth', 'true');
    } catch (clearError) {
      console.error('[auth] Error clearing session:', clearError);
    }
  }
}

/**
 * Get current user from session
 * Uses localStorage (user data is saved during login from backend)
 */
export async function getCurrentUser(): Promise<User | null> {
  try {
    const session = await sessionStorage.getSession();
    if (!session) {
      return null;
    }

    const isValid = await sessionStorage.hasValidSession();
    if (!isValid) {
      return null;
    }

    // Get user from localStorage (saved during login from backend)
    let user: User | null = await userStorage.getUser(session.userId);

    // Try by email if not found by ID
    if (!user && session.email) {
      user = await userStorage.getUserByEmail(session.email);
    }

    // Try by stored email
    if (!user) {
      const storedEmail = sessionStorage.getEmail();
      if (storedEmail) {
        user = await userStorage.getUserByEmail(storedEmail);
      }
    }

    return user;
  } catch (error) {
    console.error('[auth] Error getting current user:', error);
    return null;
  }
}

