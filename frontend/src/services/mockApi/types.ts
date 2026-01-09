/**
 * Simple user types for frontend-only app
 */

export interface User {
  id: number;
  name: string;
  email?: string;
  student?: string; // CU Boulder identikey (e.g., kare6625)
  avatarUrl?: string;
  profileData?: {
    preferredName?: string;
    theme?: string;
    font?: string;
    colorMode?: 'light' | 'dark' | 'system';
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}
