/**
 * Session database service using Supabase
 * Handles all session-related database operations
 */

import { supabase } from '@/lib/supabase';

export interface SessionData {
  token: string;
  userId: number;
  expiresAt: number;
}

const disableSupabaseSessions = import.meta.env.VITE_DISABLE_SUPABASE_SESSIONS === 'true';
let sessionFallbackMode = disableSupabaseSessions;
const fallbackSessions = new Map<number, SessionData>();

const MAX_INT = 2_147_483_647;
const normalizeUserId = (userId: number) => {
  const normalized = Math.abs(userId);
  if (normalized > MAX_INT) {
    return (normalized % MAX_INT) || 1;
  }
  return normalized;
};

const shouldFallbackForSessionError = (error: any) =>
  !!error && (error.code === 'PGRST205' || error.code === '42P01' || error.code === '22003');

function activateSessionFallback(reason?: string) {
  if (!sessionFallbackMode) {
    console.warn('[sessionDatabase] Falling back to in-memory sessions:', reason || 'unknown reason');
  }
  sessionFallbackMode = true;
}

export const sessionDatabase = {
  /**
   * Get session by user ID
   */
  async getSession(userId: number): Promise<SessionData | null> {
    const normalizedId = normalizeUserId(userId);
    if (sessionFallbackMode) {
      const session = fallbackSessions.get(normalizedId) || null;
      if (session && session.expiresAt < Date.now()) {
        fallbackSessions.delete(normalizedId);
        return null;
      }
      return session;
    }
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', normalizedId) // Store numeric_id in user_id field
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (shouldFallbackForSessionError(error)) {
          activateSessionFallback(error.message);
          return this.getSession(normalizedId);
        }
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        console.error('[sessionDatabase] Error getting session:', error);
        return null;
      }

      if (!data) return null;

      // Check if session is expired
      const expiresAt = new Date(data.expires_at).getTime();
      if (expiresAt < Date.now()) {
        // Session expired, delete it
        await this.deleteSession(userId);
        return null;
      }

      return {
        token: data.token,
        userId: typeof data.user_id === 'number' ? data.user_id : parseInt(data.user_id, 10),
        expiresAt,
      };
    } catch (error) {
      if (shouldFallbackForSessionError(error)) {
        activateSessionFallback((error as any)?.message);
        return this.getSession(normalizedId);
      }
      console.error('[sessionDatabase] Exception getting session:', error);
      return null;
    }
  },

  /**
   * Create a new session
   */
  async createSession(userId: number, expiresInDays: number = 7): Promise<SessionData> {
    const normalizedId = normalizeUserId(userId);
    const createFallbackSession = async (): Promise<SessionData> => {
      await this.deleteSession(normalizedId);
      const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
      const session: SessionData = {
        token: `local_token_${normalizedId}_${Date.now()}`,
        userId: normalizedId,
        expiresAt,
      };
      fallbackSessions.set(normalizedId, session);
      return session;
    };

    if (sessionFallbackMode) {
      return createFallbackSession();
    }

    try {
      // Delete any existing sessions for this user
      await this.deleteSession(normalizedId);

      const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
      const token = `supabase_token_${normalizedId}_${Date.now()}`;
      const expiresAtISO = new Date(expiresAt).toISOString();

      const { data, error } = await supabase
        .from('sessions')
        .insert({
          user_id: normalizedId, // Store numeric ID
          token,
          expires_at: expiresAtISO,
        })
        .select()
        .single();

      if (error) {
        if (shouldFallbackForSessionError(error)) {
          activateSessionFallback(error.message);
          return createFallbackSession();
        }
        console.error('[sessionDatabase] Error creating session:', error);
        throw error;
      }

      return {
        token: data.token,
        userId: typeof data.user_id === 'number' ? data.user_id : parseInt(data.user_id, 10),
        expiresAt: new Date(data.expires_at).getTime(),
      };
    } catch (error) {
      if (shouldFallbackForSessionError(error)) {
        activateSessionFallback((error as any)?.message);
        return createFallbackSession();
      }
      console.error('[sessionDatabase] Exception creating session:', error);
      throw error;
    }
  },

  /**
   * Delete session for a user
   */
  async deleteSession(userId: number): Promise<void> {
    const normalizedId = normalizeUserId(userId);
    if (sessionFallbackMode) {
      fallbackSessions.delete(normalizedId);
      return;
    }
    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('user_id', normalizedId);

      if (error) {
        if (shouldFallbackForSessionError(error)) {
          activateSessionFallback(error.message);
          fallbackSessions.delete(normalizedId);
          return;
        }
        console.error('[sessionDatabase] Error deleting session:', error);
        // Don't throw - session might not exist
      }
    } catch (error) {
      if (shouldFallbackForSessionError(error)) {
        activateSessionFallback((error as any)?.message);
        fallbackSessions.delete(normalizedId);
        return;
      }
      console.error('[sessionDatabase] Exception deleting session:', error);
    }
  },

  /**
   * Check if session is valid
   */
  async hasValidSession(userId: number): Promise<boolean> {
    const session = await this.getSession(userId);
    return session !== null;
  },
};

