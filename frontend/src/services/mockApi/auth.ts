/**
 * Auth API using Supabase
 * Handles user authentication and session management
 */

import { sessionStorage } from '@/storage/session';
import { userStorage } from '@/storage/user';
import type { User } from './types';

/**
 * Check if a valid session exists
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

    const user = await userStorage.getUser(session.userId);
    if (!user) {
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
 * Simple login - creates a demo user if needed
 */
export async function login(name: string, email?: string): Promise<{ user: User; isNewUser: boolean }> {
  try {
    let user: User | null = null;
    
    // Check if user exists by email
    if (email) {
      user = await userStorage.getUserByEmail(email);
    }
    
    const isNewUser = !user;
    
    if (isNewUser) {
      // Create new user
      const userId = userStorage.getNextUserId();
      user = {
        id: userId,
        name,
        email,
        profileData: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await userStorage.setUser(user);
    } else {
      // Update existing user
      user = {
        ...user,
        name,
        updatedAt: new Date().toISOString(),
      };
      await userStorage.setUser(user);
    }
    
    // Create session
    await sessionStorage.setSession(user.id, 7); // 7 days
    
    return {
      user,
      isNewUser,
    };
  } catch (error) {
    console.error('[auth] Error in login:', error);
    throw error;
  }
}

/**
 * Logout - clear session
 */
export async function logout(): Promise<void> {
  try {
    await sessionStorage.clearSession();
  } catch (error) {
    console.error('[auth] Error in logout:', error);
  }
}

/**
 * Get current user from session
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

    // If session has email, use that for lookup (more reliable)
    if (session.email) {
      const userByEmail = await userStorage.getUserByEmail(session.email);
      if (userByEmail) {
        return userByEmail;
      }
    }
    
    // Fallback to email from localStorage
    const storedEmail = sessionStorage.getEmail();
    if (storedEmail) {
      const userByStoredEmail = await userStorage.getUserByEmail(storedEmail);
      if (userByStoredEmail) {
        return userByStoredEmail;
      }
    }

    // Last resort: lookup by user ID
    return await userStorage.getUser(session.userId);
  } catch (error) {
    console.error('[auth] Error getting current user:', error);
    return null;
  }
}

/**
 * Login with email - checks if user exists and has a dataset
 */
export async function loginWithEmail(email: string): Promise<{ user: User; isNewUser: boolean } | null> {
  await new Promise(resolve => setTimeout(resolve, 200));
  
  // Normalize email to lowercase for consistent lookup
  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[auth] Login attempt for email: ${normalizedEmail}`);
  
  // Check if user exists by email (case-insensitive) - from Supabase
  let user = await userStorage.getUserByEmail(normalizedEmail);
  
  const isNewUser = !user;
  
  if (isNewUser) {
    // Create new user with normalized email
    const userId = userStorage.getNextUserId();
    user = {
      id: userId,
      name: normalizedEmail.split('@')[0], // Use email prefix as default name
      email: normalizedEmail, // Store normalized email
      profileData: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await userStorage.setUser(user);
    console.log(`[auth] Created new user with ID: ${userId}, email: ${normalizedEmail}`);
  } else {
    // Update email to normalized version if needed
    if (user.email !== normalizedEmail) {
      user = {
        ...user,
        email: normalizedEmail,
        updatedAt: new Date().toISOString(),
      };
      await userStorage.setUser(user);
      console.log(`[auth] Updated user email to normalized version: ${normalizedEmail}`);
    }
    console.log(`[auth] Found existing user with ID: ${user.id}, email: ${normalizedEmail}`);
  }
  
  // Create session with email
  try {
    await sessionStorage.setSession(user.id, 7, normalizedEmail); // 7 days with email
    console.log(`[auth] Session created for user ID: ${user.id}, email: ${normalizedEmail}`);
  } catch (sessionError) {
    console.error('[auth] Error creating session:', sessionError);
    throw new Error('Failed to create session. Please try again.');
  }
  
  // Verify session was created
  const verifySession = await sessionStorage.getSession();
  if (!verifySession) {
    console.error('[auth] Session verification failed - session not found after creation');
    throw new Error('Session creation failed. Please try again.');
  }
  console.log(`[auth] Session verified: user ID ${verifySession.userId}, email: ${verifySession.email}`);
  
  return {
    user,
    isNewUser,
  };
}
