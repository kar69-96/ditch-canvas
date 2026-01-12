/**
 * Utility function to clear user session for testing/debugging
 * Can be called from browser console: clearUserData('kare6625@colorado.edu')
 */

import { sessionStorage } from '@/storage/session';
import { clearCacheForUser } from '@/services/api/canvasApi';

/**
 * Clear session and cache for a specific user by email
 * This can be called from the browser console for debugging
 */
export async function clearUserDataByEmail(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  console.log(`Clearing session and cache for email: ${normalizedEmail}`);

  // Clear session if it matches
  const session = await sessionStorage.getSession();
  if (session?.email?.toLowerCase() === normalizedEmail) {
    console.log(`  - Clearing session`);
    await sessionStorage.clearSession();
  }

  // Clear API cache
  clearCacheForUser(normalizedEmail);
  console.log(`  - Cleared API cache`);

  console.log(`Completed clearing data for: ${normalizedEmail}`);
  console.log(`   Please refresh the page and log in again.`);
}

// Make it available globally for console access
if (typeof window !== 'undefined') {
  (window as any).clearUserData = clearUserDataByEmail;
  console.log('Utility available: Use clearUserData("email@colorado.edu") in console to clear session');
}
