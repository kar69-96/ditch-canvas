/**
 * Utility function to clear all user data for testing/debugging
 * Can be called from browser console: clearUserData('kare6625@colorado.edu')
 */

import { userStorage } from '@/storage/user';
import { sessionStorage } from '@/storage/session';
import { clearCacheForUser } from '@/services/api/canvasApi';

/**
 * Clear all data for a specific user by email
 * This can be called from the browser console for debugging
 */
export async function clearUserDataByEmail(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  console.log(`🧹 Clearing all data for email: ${normalizedEmail}`);
  
  // Get all users and find matching email
  const allUsers = await userStorage.getAllUsers();
  const matchingUsers = allUsers.filter(u => u.email?.toLowerCase() === normalizedEmail);
  
  // Delete user records
  for (const user of matchingUsers) {
    console.log(`  - Deleting user record for ID: ${user.id}`);
    await userStorage.deleteUser(user.id);
  }
  
  // Clear session if it matches
  const session = await sessionStorage.getSession();
  if (session) {
    const sessionUser = await userStorage.getUser(session.userId);
    if (sessionUser?.email?.toLowerCase() === normalizedEmail) {
      console.log(`  - Clearing session for user ID: ${session.userId}`);
      await sessionStorage.clearSession();
    }
  }
  
  // Clear API cache
  clearCacheForUser(normalizedEmail);
  console.log(`  - Cleared API cache`);
  
  console.log(`✅ Completed clearing data for: ${normalizedEmail}`);
  console.log(`   Please refresh the page and log in again.`);
}

// Make it available globally for console access
if (typeof window !== 'undefined') {
  (window as any).clearUserData = clearUserDataByEmail;
  console.log('💡 Utility available: Use clearUserData("kare6625@colorado.edu") in console to clear user data');
}

