/**
 * Supabase client configuration
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          numeric_id: number;
          email: string;
          name: string;
          avatar_url: string | null;
          profile_data: Record<string, any> | null;
          phone_number: string | null;
          school: string | null;
          cookies: Record<string, any> | null;
          invite_code_used: string | null;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          numeric_id: number;
          email: string;
          name: string;
          avatar_url?: string | null;
          profile_data?: Record<string, any> | null;
          phone_number?: string | null;
          school?: string | null;
          cookies?: Record<string, any> | null;
          invite_code_used?: string | null;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          numeric_id?: number;
          email?: string;
          name?: string;
          avatar_url?: string | null;
          profile_data?: Record<string, any> | null;
          phone_number?: string | null;
          school?: string | null;
          cookies?: Record<string, any> | null;
          invite_code_used?: string | null;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      waitlist: {
        Row: {
          id: string;
          first_name: string;
          school: string;
          email: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          first_name: string;
          school: string;
          email: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          first_name?: string;
          school?: string;
          email?: string;
          created_at?: string;
        };
      };
      invite_codes: {
        Row: {
          code: string;
          max_users: number;
          current_users: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          max_users: number;
          current_users?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          max_users?: number;
          current_users?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      sessions: {
        Row: {
          id: string;
          user_id: number;
          token: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: number;
          token: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: number;
          token?: string;
          expires_at?: string;
          created_at?: string;
        };
      };
    };
  };
}

