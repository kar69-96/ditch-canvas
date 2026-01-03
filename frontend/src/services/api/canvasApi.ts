/**
 * Canvas API Gateway
 * Provides a unified API interface for accessing Canvas data
 * Routes requests to the appropriate dataset based on user email
 */

import { getCurrentUser } from '../mockApi/auth';
import { loadCanvasDataForUser } from './dataLoader';
import type { CanvasData } from './dataLoader';

// Cache for loaded data (keyed by email)
const dataCache = new Map<string, { data: CanvasData; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get Canvas data for the current user
 */
export async function getCanvasData(): Promise<CanvasData | null> {
  const user = await getCurrentUser();
  if (!user || !user.email) {
    console.warn('No user or email found in session');
    return null;
  }

  console.log(`[canvasApi] Loading Canvas data for user: ${user.email}`);

  // Clear cache for kare6625@colorado.edu to force fresh load
  if (user.email.toLowerCase() === 'kare6625@colorado.edu') {
    console.log('[canvasApi] Clearing cache for kare6625@colorado.edu to force fresh load');
    dataCache.delete(user.email);
  }

  // Check cache first
  const cached = dataCache.get(user.email);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[canvasApi] Returning cached data for', user.email);
    return cached.data;
  }

  // Load data from dataset
  try {
    const data = await loadCanvasDataForUser(user.email);
    if (data) {
      console.log('Successfully loaded data for', user.email);
      dataCache.set(user.email, { data, timestamp: Date.now() });
      return data;
    } else {
      console.warn(`No dataset found for email: ${user.email}`);
      return null;
    }
  } catch (error) {
    console.error(`Error loading data for ${user.email}:`, error);
    throw error;
  }
}

/**
 * Get user information
 */
export async function getUser(): Promise<CanvasData['user'] | null> {
  const data = await getCanvasData();
  return data?.user || null;
}

/**
 * Get all courses for the current user
 */
export async function getCourses(): Promise<CanvasData['courses']> {
  const data = await getCanvasData();
  return data?.courses || [];
}

/**
 * Get a specific course by ID
 */
export async function getCourse(courseId: number): Promise<CanvasData['courses'][0] | null> {
  const courses = await getCourses();
  return courses.find(c => c.id === courseId) || null;
}

/**
 * Get all assignments for the current user
 */
export async function getAssignments(): Promise<CanvasData['assignments']> {
  const data = await getCanvasData();
  return data?.assignments || [];
}

/**
 * Get assignments for a specific course
 */
export async function getAssignmentsByCourse(courseId: number): Promise<CanvasData['assignments']> {
  const assignments = await getAssignments();
  return assignments.filter(a => a.courseId === courseId);
}

/**
 * Get a specific assignment by ID
 */
export async function getAssignment(assignmentId: number): Promise<CanvasData['assignments'][0] | null> {
  const assignments = await getAssignments();
  return assignments.find(a => a.id === assignmentId) || null;
}

/**
 * Get all announcements for the current user
 */
export async function getAnnouncements(): Promise<CanvasData['announcements']> {
  const data = await getCanvasData();
  return data?.announcements || [];
}

/**
 * Update assignment completion status in Supabase
 * This is the single source of truth for completion status
 */
export async function updateAssignmentCompletion(
  assignmentId: number,
  isCompleted: boolean,
  courseId?: number
): Promise<{ success: boolean; message?: string }> {
  const user = await getCurrentUser();
  if (!user?.email) {
    throw new Error("No user email available");
  }

  const API_BASE =
    import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "http://localhost:3000/api";

  const res = await fetch(`${API_BASE}/assignments/${assignmentId}/complete`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userEmail: user.email,
      isCompleted,
      courseId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update assignment completion: ${text}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Get announcements for a specific course
 */
export async function getAnnouncementsByCourse(courseId: number): Promise<CanvasData['announcements']> {
  const announcements = await getAnnouncements();
  return announcements.filter(a => a.courseId === courseId);
}

/**
 * Get all modules for the current user
 */
export async function getModules(): Promise<CanvasData['modules']> {
  const data = await getCanvasData();
  return data?.modules || [];
}

/**
 * Get modules for a specific course
 */
export async function getModulesByCourse(courseId: number): Promise<CanvasData['modules']> {
  const modules = await getModules();
  return modules.filter(m => m.courseId === courseId);
}

/**
 * Get grades for the current user
 */
export async function getGrades(): Promise<CanvasData['grades'] | null> {
  const data = await getCanvasData();
  return data?.grades || null;
}

/**
 * Clear the data cache (useful for testing or forced refresh)
 */
export function clearCache(): void {
  dataCache.clear();
  console.log('[canvasApi] Cache cleared');
}

/**
 * Clear cache for a specific user
 */
export function clearCacheForUser(email: string): void {
  dataCache.delete(email);
}

