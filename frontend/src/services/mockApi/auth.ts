/**
 * Auth API using Supabase
 * Handles user authentication and session management
 */

import { sessionStorage } from '@/storage/session';
import { userStorage } from '@/storage/user';
import { userDatabase } from '@/services/database/userDatabase';
import { clearCacheForUser } from '@/services/api/canvasApi';
import type { User } from './types';

/**
 * Check if a valid session exists
 * Looks up user in Supabase database
 */
export async function checkSession(): Promise<{ userId: number; user: User } | null> {
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

    // Try to get user from Supabase first (by email if available, then by ID)
    let user: User | null = null;
    
    if (session.email) {
      user = await userDatabase.getUserByEmail(session.email);
    }
    
    if (!user) {
      user = await userDatabase.getUser(session.userId);
    }
    
    // Fallback to localStorage if Supabase lookup fails
    if (!user) {
      user = await userStorage.getUser(session.userId);
    }

    if (!user) {
      await sessionStorage.clearSession();
      return null;
    }

    // Sync to localStorage for compatibility
    await userStorage.setUser(user);

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
    // Get user email before clearing session (so we can clear their cache and cookies)
    const session = await sessionStorage.getSession();
    const userEmail = session?.email || sessionStorage.getEmail();
    
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
 * Looks up user in Supabase database first, falls back to localStorage
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

    // If session has email, use that for lookup in Supabase (most reliable)
    if (session.email) {
      const userByEmail = await userDatabase.getUserByEmail(session.email);
      if (userByEmail) {
        // Also sync to localStorage for compatibility
        await userStorage.setUser(userByEmail);
        return userByEmail;
      }
    }
    
    // Fallback to email from localStorage
    const storedEmail = sessionStorage.getEmail();
    if (storedEmail) {
      const userByStoredEmail = await userDatabase.getUserByEmail(storedEmail);
      if (userByStoredEmail) {
        await userStorage.setUser(userByStoredEmail);
        return userByStoredEmail;
      }
    }

    // Last resort: lookup by user ID in Supabase
    const userById = await userDatabase.getUser(session.userId);
    if (userById) {
      await userStorage.setUser(userById);
      return userById;
    }

    // Final fallback: check localStorage
    return await userStorage.getUser(session.userId);
  } catch (error) {
    console.error('[auth] Error getting current user:', error);
    return null;
  }
}

