/**
 * User storage service - localStorage-based for reliability
 * Supabase users table may not exist, so use localStorage as primary storage
 */

import type { User } from '@/services/mockApi/types';

// Keys for localStorage
const USER_PREFIX = 'canvas_user_';
const USERS_BY_EMAIL_KEY = 'canvas_users_by_email';

function getUsersIndex(): Record<string, number> {
  try {
    const data = localStorage.getItem(USERS_BY_EMAIL_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

function setUsersIndex(index: Record<string, number>): void {
  localStorage.setItem(USERS_BY_EMAIL_KEY, JSON.stringify(index));
}

export const userStorage = {
  /**
   * Get user by ID
   */
  async getUser(userId: number): Promise<User | null> {
    try {
      const key = `${USER_PREFIX}${userId}`;
      const data = localStorage.getItem(key);
      if (!data) return null;
      return JSON.parse(data);
    } catch {
      return null;
    }
  },

  /**
   * Set/update user
   */
  async setUser(user: User): Promise<void> {
    const key = `${USER_PREFIX}${user.id}`;
    localStorage.setItem(key, JSON.stringify(user));
    
    // Update email index
    if (user.email) {
      const index = getUsersIndex();
      index[user.email.toLowerCase().trim()] = user.id;
      setUsersIndex(index);
    }
    
    console.log('[userStorage] User saved:', { id: user.id, email: user.email });
  },

  /**
   * Delete user
   */
  async deleteUser(userId: number): Promise<void> {
    const user = await this.getUser(userId);
    
    // Remove from email index
    if (user?.email) {
      const index = getUsersIndex();
      delete index[user.email.toLowerCase().trim()];
      setUsersIndex(index);
    }
    
    const key = `${USER_PREFIX}${userId}`;
    localStorage.removeItem(key);
  },

  /**
   * Get all users
   */
  async getAllUsers(): Promise<User[]> {
    const users: User[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(USER_PREFIX)) {
        try {
          const user: User = JSON.parse(localStorage.getItem(key) || '{}');
          users.push(user);
        } catch {
          // Skip invalid entries
        }
      }
    }
    return users;
  },

  /**
   * Get next user ID
   */
  getNextUserId(): number {
    return Date.now();
  },

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check email index first (fast lookup)
    const index = getUsersIndex();
    const userId = index[normalizedEmail];
    if (userId) {
      const user = await this.getUser(userId);
      if (user) return user;
    }
    
    // Fallback: search all users
    const allUsers = await this.getAllUsers();
    return allUsers.find(u => u.email?.toLowerCase().trim() === normalizedEmail) || null;
  },
};
