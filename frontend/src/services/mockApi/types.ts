/**
 * User type - matches simplified Supabase schema
 */

export interface User {
  // Identity
  id: string; // UUID (not number!)
  email: string;

  // Profile (from sign-up)
  firstName: string;
  student: string; // CU Boulder identikey (e.g., "kare6625")
  school: string; // "University of Colorado - Boulder"

  // Authentication
  canvasCookies?: any[];
  canvasCookiesUpdatedAt?: string;
  lastLoginAt?: string;

  // Onboarding
  inviteCodeUsed?: string;
  onboardingCompletedAt?: string;

  // Contact
  phoneNumber?: string;

  // Preferences
  profilePreferences?: {
    theme?: "light" | "dark" | "system";
    font?: string;
    [key: string]: any;
  };

  // System
  createdAt: string;
  updatedAt: string;
}
