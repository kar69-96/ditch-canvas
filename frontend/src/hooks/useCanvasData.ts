/**
 * React hook for accessing Canvas data through the API gateway
 * Uses React Query for caching and request deduplication
 */

import { useQuery } from '@tanstack/react-query';
import { sessionStorage } from '@/storage/session';
import * as canvasApi from '@/services/api/canvasApi';
import type { CanvasData } from '@/services/api/dataLoader';

// Query key factory
export const canvasDataKeys = {
  all: ['canvasData'] as const,
  user: (email: string | null) => [...canvasDataKeys.all, email || 'anonymous'] as const,
};

export function useCanvasData() {
  // Get user email for cache key
  const userEmail = typeof window !== 'undefined' 
    ? sessionStorage.getEmail()
    : null;

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: canvasDataKeys.user(userEmail),
    queryFn: async () => {
      const canvasData = await canvasApi.getCanvasData();
      if (!canvasData) {
        throw new Error('No data available for your account. Please contact support.');
      }
      console.log('Canvas data loaded successfully:', {
        courses: canvasData.courses.length,
        assignments: canvasData.assignments.length,
        announcements: canvasData.announcements.length
      });
      return canvasData;
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes (formerly cacheTime)
    retry: 1,
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnMount: false, // Use cached data if available
    enabled: !!userEmail, // Only run query if we have a user email
  });

  return { 
    data: data || null, 
    loading: isLoading || isFetching, 
    error: error as Error | null 
  };
}

export function useCourses() {
  const { data, loading, error } = useCanvasData();
  return { courses: data?.courses || [], loading, error };
}

export function useAssignments() {
  const { data, loading, error } = useCanvasData();
  return { assignments: data?.assignments || [], loading, error };
}

export function useAnnouncements() {
  const { data, loading, error } = useCanvasData();
  return { announcements: data?.announcements || [], loading, error };
}

export function useModules() {
  const { data, loading, error } = useCanvasData();
  return { modules: data?.modules || [], loading, error };
}

export function useGrades() {
  const { data, loading, error } = useCanvasData();
  return { grades: data?.grades || null, loading, error };
}

