/**
 * User database service using Supabase
 * Handles all user-related database operations
 */

import { supabase } from '@/lib/supabase';
import type { User } from '@/services/mockApi/types';

const disableSupabaseUsers = import.meta.env.VITE_DISABLE_SUPABASE_USERS === 'true';
let userFallbackMode = disableSupabaseUsers;
const fallbackUsers = new Map<number, User>();
const fallbackEmailToId = new Map<string, number>();

function activateUserFallback(reason?: string) {
  if (!userFallbackMode) {
    console.warn('[userDatabase] Falling back to in-memory user store:', reason || 'unknown reason');
  }
  userFallbackMode = true;
}

function storeFallbackUser(user: User) {
  fallbackUsers.set(user.id, user);
  if (user.email) {
    fallbackEmailToId.set(user.email.toLowerCase().trim(), user.id);
  }
}

function getFallbackUserByEmail(email: string): User | null {
  const id = fallbackEmailToId.get(email.toLowerCase().trim());
  return typeof id === 'number' ? fallbackUsers.get(id) || null : null;
}

/**
 * Convert email to a consistent numeric ID (hash)
 * This allows us to use numeric IDs while storing UUIDs in Supabase
 */
function emailToNumericId(email: string): number {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function shouldFallbackForError(error: any): boolean {
  // Network errors, connection failures, and missing tables should trigger fallback
  const isNetworkError = error?.message?.includes('Load failed') || 
                         error?.message?.includes('Failed to fetch') ||
                         error?.message?.includes('NetworkError') ||
                         error?.name === 'TypeError';
  return !!error && (
    error.code === 'PGRST205' || 
    error.code === '42P01' ||
    isNetworkError
  );
}

/**
 * Convert Supabase user row to User type
 * Supabase uses UUID strings, but we convert to numeric IDs for compatibility
 */
function supabaseRowToUser(row: any): User {
  // Use the stored numeric_id if available, otherwise hash the email
  const numericId = row.numeric_id || (row.email ? emailToNumericId(row.email) : parseInt(row.id.replace(/-/g, '').substring(0, 10), 16));

  // Include phone_number in profileData if it exists
  const profileData = row.profile_data || {};
  if (row.phone_number && !profileData.phoneNumber) {
    profileData.phoneNumber = row.phone_number;
  }

  return {
    id: numericId,
    name: row.name,
    email: row.email,
    student: row.student || undefined, // CU Boulder identikey
    avatarUrl: row.avatar_url || undefined,
    profileData,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert User type to Supabase insert/update format
 */
function userToSupabaseRow(user: User): any {
  // Extract phone_number from profileData if it exists
  const phoneNumber = user.profileData?.phoneNumber || null;
  const profileData = { ...user.profileData };
  // Remove phoneNumber from profileData since we store it in a separate column
  if (profileData.phoneNumber) {
    delete profileData.phoneNumber;
  }

  return {
    id: user.id.toString(), // Store as string, Supabase will handle UUID generation if needed
    numeric_id: user.id, // Store numeric ID for easy lookup
    name: user.name,
    email: user.email?.toLowerCase().trim(),
    student: user.student || null, // CU Boulder identikey
    avatar_url: user.avatarUrl || null,
    profile_data: profileData,
    phone_number: phoneNumber,
    updated_at: user.updatedAt,
  };
}

export const userDatabase = {
  /**
   * Get user by ID (numeric ID)
   */
  async getUser(userId: number): Promise<User | null> {
    if (userFallbackMode) {
      return fallbackUsers.get(userId) || null;
    }
    try {
      // Query by numeric_id field
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('numeric_id', userId)
        .single();

      if (error) {
        if (shouldFallbackForError(error)) {
          activateUserFallback(error.message);
          return fallbackUsers.get(userId) || null;
        }
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        console.error('[userDatabase] Error getting user:', error);
        return null;
      }

      return data ? supabaseRowToUser(data) : null;
    } catch (error) {
      if (shouldFallbackForError(error)) {
        activateUserFallback((error as any)?.message);
        return fallbackUsers.get(userId) || null;
      }
      console.error('[userDatabase] Exception getting user:', error);
      return null;
    }
  },

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim();
    if (userFallbackMode) {
      return getFallbackUserByEmail(normalizedEmail);
    }
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', normalizedEmail)
        .single();

      if (error) {
        if (shouldFallbackForError(error)) {
          console.warn('[userDatabase] Supabase connection failed, falling back to localStorage:', error.message);
          activateUserFallback(error.message);
          return getFallbackUserByEmail(normalizedEmail);
        }
        if (error.code === 'PGRST116') {
          // No rows returned - user doesn't exist
          return null;
        }
        console.error('[userDatabase] Error getting user by email:', error);
        // For other errors, try fallback before giving up
        if (!userFallbackMode) {
          activateUserFallback(error.message);
          return getFallbackUserByEmail(normalizedEmail);
        }
        return null;
      }

      return data ? supabaseRowToUser(data) : null;
    } catch (error) {
      const errorObj = error as any;
      if (shouldFallbackForError(errorObj)) {
        console.warn('[userDatabase] Supabase exception, falling back to localStorage:', errorObj?.message);
        activateUserFallback(errorObj?.message);
        return getFallbackUserByEmail(normalizedEmail);
      }
      console.error('[userDatabase] Exception getting user by email:', error);
      // Last resort: try fallback
      if (!userFallbackMode) {
        activateUserFallback(errorObj?.message);
        return getFallbackUserByEmail(normalizedEmail);
      }
      return null;
    }
  },

  /**
   * Create a new user
   */
  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const createInMemory = (): User => {
      const now = new Date().toISOString();
      const email = user.email?.toLowerCase().trim() || '';
      const numericId = email ? emailToNumericId(email) : Date.now() % 2_147_483_647;
      const createdUser: User = {
        id: numericId,
        name: user.name,
        email,
        student: user.student,
        avatarUrl: user.avatarUrl,
        profileData: user.profileData || {},
        createdAt: now,
        updatedAt: now,
      };
      storeFallbackUser(createdUser);
      return createdUser;
    };

    if (userFallbackMode) {
      return createInMemory();
    }

    try {
      const now = new Date().toISOString();
      const email = user.email?.toLowerCase().trim() || '';
      const numericId = email ? emailToNumericId(email) : Date.now() % 2_147_483_647;
      
      // Extract phone_number from profileData if it exists
      const phoneNumber = user.profileData?.phoneNumber || null;
      const profileData = { ...(user.profileData || {}) };
      // Remove phoneNumber from profileData since we store it in a separate column
      if (profileData.phoneNumber) {
        delete profileData.phoneNumber;
      }
      
      const insertData = {
        id: numericId.toString(), // Use numeric ID as string for Supabase
        numeric_id: numericId, // Store numeric ID for queries
        name: user.name,
        email: email,
        student: user.student || null, // CU Boulder identikey
        avatar_url: user.avatarUrl || null,
        profile_data: profileData,
        phone_number: phoneNumber,
        created_at: now,
        updated_at: now,
      };

      const { data, error } = await supabase
        .from('users')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        if (shouldFallbackForError(error)) {
          activateUserFallback(error.message);
          return createInMemory();
        }
        console.error('[userDatabase] Error creating user:', error);
        throw error;
      }

      const createdUser = supabaseRowToUser(data);

      if (email) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
          await supabase.rpc('ensure_user_tables_exist', { user_email: email });
          console.log(`[userDatabase] Ensured tables exist for user: ${email}`);
        } catch (tableError) {
          console.warn(`[userDatabase] Could not ensure tables exist (may need manual creation):`, tableError);
        }
      }

      return createdUser;
    } catch (error) {
      if (shouldFallbackForError(error)) {
        activateUserFallback((error as any)?.message);
        return createInMemory();
      }
      console.error('[userDatabase] Exception creating user:', error);
      throw error;
    }
  },

  /**
   * Update an existing user
   */
  async updateUser(user: User): Promise<User> {
    const updateInMemory = (): User => {
      const existing = fallbackUsers.get(user.id);
      const updatedUser: User = {
        ...existing,
        ...user,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storeFallbackUser(updatedUser);
      return updatedUser;
    };

    if (userFallbackMode) {
      return updateInMemory();
    }

    try {
      // Extract phone_number from profileData if it exists
      const phoneNumber = user.profileData?.phoneNumber || null;
      const profileData = { ...user.profileData };
      // Remove phoneNumber from profileData since we store it in a separate column
      if (profileData.phoneNumber) {
        delete profileData.phoneNumber;
      }
      
      const updateData = {
        name: user.name,
        email: user.email?.toLowerCase().trim(),
        student: user.student || null, // CU Boulder identikey
        avatar_url: user.avatarUrl || null,
        profile_data: profileData,
        phone_number: phoneNumber,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('numeric_id', user.id) // Query by numeric_id
        .select()
        .single();

      if (error) {
        if (shouldFallbackForError(error)) {
          activateUserFallback(error.message);
          return updateInMemory();
        }
        console.error('[userDatabase] Error updating user:', error);
        throw error;
      }

      return supabaseRowToUser(data);
    } catch (error) {
      if (shouldFallbackForError(error)) {
        activateUserFallback((error as any)?.message);
        return updateInMemory();
      }
      console.error('[userDatabase] Exception updating user:', error);
      throw error;
    }
  },

  /**
   * Create or update user (upsert)
   */
  async upsertUser(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    const upsertInMemory = (): User => {
      const existing = user.id ? fallbackUsers.get(user.id) : null;
      const now = new Date().toISOString();
      const email = user.email?.toLowerCase().trim() || existing?.email || '';
      const numericId = user.id || existing?.id || (email ? emailToNumericId(email) : Date.now() % 2_147_483_647);
      const mergedUser: User = {
        id: numericId,
        name: user.name || existing?.name || 'User',
        email,
        student: user.student ?? existing?.student,
        avatarUrl: user.avatarUrl ?? existing?.avatarUrl,
        profileData: user.profileData || existing?.profileData || {},
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      storeFallbackUser(mergedUser);
      return mergedUser;
    };

    if (userFallbackMode) {
      return upsertInMemory();
    }

    try {
      const now = new Date().toISOString();
      const email = user.email?.toLowerCase().trim() || '';
      const numericId = user.id || (email ? emailToNumericId(email) : Date.now() % 2_147_483_647);
      
      // Extract phone_number from profileData if it exists
      const phoneNumber = user.profileData?.phoneNumber || null;
      const profileData = { ...(user.profileData || {}) };
      // Remove phoneNumber from profileData since we store it in a separate column
      if (profileData.phoneNumber) {
        delete profileData.phoneNumber;
      }
      
      const upsertData = {
        id: numericId.toString(),
        numeric_id: numericId,
        name: user.name,
        email: email,
        student: user.student || null, // CU Boulder identikey
        avatar_url: user.avatarUrl || null,
        profile_data: profileData,
        phone_number: phoneNumber,
        updated_at: now,
        created_at: now, // Will be ignored on update if using upsert
      };

      // Use Supabase upsert (insert or update)
      const { data, error } = await supabase
        .from('users')
        .upsert(upsertData, {
          onConflict: 'numeric_id', // Use numeric_id as conflict key
        })
        .select()
        .single();

      if (error) {
        if (shouldFallbackForError(error)) {
          activateUserFallback(error.message);
          return upsertInMemory();
        }
        console.error('[userDatabase] Error upserting user:', error);
        throw error;
      }

      return supabaseRowToUser(data);
    } catch (error) {
      if (shouldFallbackForError(error)) {
        activateUserFallback((error as any)?.message);
        return upsertInMemory();
      }
      console.error('[userDatabase] Exception upserting user:', error);
      throw error;
    }
  },

  /**
   * Delete user by ID
   */
  async deleteUser(userId: number): Promise<void> {
    if (userFallbackMode) {
      fallbackUsers.delete(userId);
      for (const [email, id] of fallbackEmailToId.entries()) {
        if (id === userId) {
          fallbackEmailToId.delete(email);
        }
      }
      return;
    }
    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('numeric_id', userId);

      if (error) {
        if (shouldFallbackForError(error)) {
          activateUserFallback(error.message);
          fallbackUsers.delete(userId);
          return;
        }
        console.error('[userDatabase] Error deleting user:', error);
        throw error;
      }
    } catch (error) {
      if (shouldFallbackForError(error)) {
        activateUserFallback((error as any)?.message);
        fallbackUsers.delete(userId);
        return;
      }
      console.error('[userDatabase] Exception deleting user:', error);
      throw error;
    }
  },

  /**
   * Get all users (for admin/debugging purposes)
   */
  async getAllUsers(): Promise<User[]> {
    if (userFallbackMode) {
      return Array.from(fallbackUsers.values());
    }
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        if (shouldFallbackForError(error)) {
          activateUserFallback(error.message);
          return Array.from(fallbackUsers.values());
        }
        console.error('[userDatabase] Error getting all users:', error);
        return [];
      }

      return (data || []).map(supabaseRowToUser);
    } catch (error) {
      if (shouldFallbackForError(error)) {
        activateUserFallback((error as any)?.message);
        return Array.from(fallbackUsers.values());
      }
      console.error('[userDatabase] Exception getting all users:', error);
      return [];
    }
  },
};

