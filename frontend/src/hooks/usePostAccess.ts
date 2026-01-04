/**
 * Hook for managing post access
 * NOTE: All posts and responses are now free to view - access is always granted
 */

import { usePostAccess as usePostAccessQuery } from './useChat';

export function usePostAccess(postId: string | null) {
  const { data: accessStatus, isLoading } = usePostAccessQuery(postId);

  // All posts and responses are free to view
  return {
    hasAccess: true, // Always true - all content is free
    isContributor: accessStatus?.isContributor || false,
    canUnlock: false, // No unlocking needed
    unlockApplied: false,
    firstUnlockAvailable: false,
    availableCredits: 0,
    isLoading,
    unlock: async () => {}, // No-op - no unlocking needed
    isUnlocking: false,
  };
}

