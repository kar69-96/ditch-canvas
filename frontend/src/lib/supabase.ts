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

// Database types - matches actual Supabase schema
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;  // UUID primary key
          email: string;
          first_name: string | null;
          student: string | null;  // CU Boulder identikey
          school: string | null;
          canvas_cookies: any[] | null;
          canvas_cookies_updated_at: string | null;
          last_login_at: string | null;
          invite_code_used: string | null;
          onboarding_completed_at: string | null;
          profile_preferences: Record<string, any> | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          first_name?: string | null;
          student?: string | null;
          school?: string | null;
          canvas_cookies?: any[] | null;
          canvas_cookies_updated_at?: string | null;
          last_login_at?: string | null;
          invite_code_used?: string | null;
          onboarding_completed_at?: string | null;
          profile_preferences?: Record<string, any> | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          first_name?: string | null;
          student?: string | null;
          school?: string | null;
          canvas_cookies?: any[] | null;
          canvas_cookies_updated_at?: string | null;
          last_login_at?: string | null;
          invite_code_used?: string | null;
          onboarding_completed_at?: string | null;
          profile_preferences?: Record<string, any> | null;
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

