/**
 * Auth API using Supabase
 * Handles user authentication and session management
 */

import { sessionStorage } from '@/storage/session';
import { userStorage } from '@/storage/user';
import { userDatabase } from '@/services/database/userDatabase';
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

/**
 * Login with email - looks up user in Supabase database and logs them in
 * Creates user in Supabase if it doesn't exist (when Supabase is available)
 * Returns null if user not found and Supabase is unavailable
 * Throws error if database connection fails
 */
export async function loginWithEmail(email: string): Promise<{ user: User } | null> {
  // Normalize email to lowercase for consistent lookup
  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[auth] Login attempt for email: ${normalizedEmail}`);
  
  try {
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database request timed out')), 10000); // 10 second timeout
    });
    
    // Look up user in Supabase database by email with timeout
    let user = await Promise.race([
      userDatabase.getUserByEmail(normalizedEmail),
      timeoutPromise
    ]);
    
    // If user doesn't exist, try to create it in Supabase
    if (!user) {
      console.log(`[auth] User not found in database for email: ${normalizedEmail}, attempting to create...`);
      
      // Try to create user in Supabase
      try {
        // Extract name from email (use part before @)
        const name = normalizedEmail.split('@')[0] || 'User';
        
        console.log(`[auth] Creating user in Supabase: ${normalizedEmail}`);
        user = await userDatabase.createUser({
          name,
          email: normalizedEmail,
          profileData: {},
        });
        
        console.log(`[auth] Created user in Supabase: ID ${user.id}, email: ${normalizedEmail}`);
      } catch (createError) {
        // If creation fails, check the error type
        console.error('[auth] Failed to create user in Supabase:', createError);
        const errorMessage = createError instanceof Error ? createError.message : String(createError);
        
        // If it's a table/schema error, provide helpful message
        if (errorMessage.includes('table') || 
            errorMessage.includes('schema cache') || 
            errorMessage.includes('Could not find')) {
          throw new Error('Database table not found. Please run the Supabase migrations (001_create_users_and_sessions.sql) to create the users table.');
        }
        
        // For other errors (like duplicate key), the user might already exist, try fetching again
        if (errorMessage.includes('duplicate') || errorMessage.includes('unique')) {
          console.log(`[auth] User may already exist, retrying fetch...`);
          user = await userDatabase.getUserByEmail(normalizedEmail);
          if (user) {
            console.log(`[auth] Found user after creation attempt: ID ${user.id}`);
          }
        }
        
        // If still no user, return null
        if (!user) {
          return null;
        }
      }
    }
    
    if (!user) {
      console.log(`[auth] Could not find or create user for email: ${normalizedEmail}`);
      return null;
    }
    
    console.log(`[auth] Found/created user in database: ID ${user.id}, email: ${normalizedEmail}`);
    
    // Also store in localStorage for compatibility with existing code
    await userStorage.setUser(user);
    
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
    };
  } catch (error) {
    // Check if this is a network/database connection error
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Load failed') || 
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('timed out')) {
      console.error('[auth] Database connection failed:', error);
      throw new Error('Unable to connect to database. Please check your internet connection and Supabase configuration.');
    }
    // Re-throw other errors
    throw error;
  }
}
