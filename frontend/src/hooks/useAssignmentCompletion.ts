import { useState, useEffect, useCallback } from 'react';
import { updateAssignmentCompletion } from '@/services/api/canvasApi';
import { useCanvasData } from './useCanvasData';
import { toast } from '@/hooks/use-toast';

/**
 * Hook to manage assignment completion status
 * Updates Supabase (single source of truth) and keeps localStorage in sync for immediate UI updates
 */
export function useAssignmentCompletion() {
  const { data: canvasData } = useCanvasData();
  const [completedAssignments, setCompletedAssignments] = useState<Set<number>>(() => {
    const stored = localStorage.getItem('completedAssignments');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });

  // Sync to localStorage whenever completedAssignments changes
  useEffect(() => {
    localStorage.setItem('completedAssignments', JSON.stringify(Array.from(completedAssignments)));
  }, [completedAssignments]);

  // Automatically mark assignments as completed if submissionStatus === "yes" from Canvas
  useEffect(() => {
    if (!canvasData || !canvasData.assignments) return;
    
    setCompletedAssignments(prev => {
      const newSet = new Set(prev);
      let hasChanges = false;
      
      canvasData.assignments.forEach(assignment => {
        if (assignment.submissionStatus === "yes" && !newSet.has(assignment.id)) {
          newSet.add(assignment.id);
          hasChanges = true;
        }
      });
      
      return hasChanges ? newSet : prev;
    });
  }, [canvasData]);

  // Listen for completion changes from other windows/tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'completedAssignments' && e.newValue) {
        try {
          const newCompleted = new Set<number>(JSON.parse(e.newValue));
          setCompletedAssignments(newCompleted);
        } catch (error) {
          console.error('Error parsing completedAssignments:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for custom events (for same-window updates)
    const handleCustomStorage = () => {
      const stored = localStorage.getItem('completedAssignments');
      if (stored) {
        setCompletedAssignments(new Set(JSON.parse(stored)));
      }
    };

    window.addEventListener('completedAssignmentsUpdated', handleCustomStorage);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('completedAssignmentsUpdated', handleCustomStorage);
    };
  }, []);

  /**
   * Toggle assignment completion status
   * Updates Supabase (single source of truth) and triggers integration syncs
   */
  const toggleAssignmentComplete = useCallback(async (
    assignmentId: number,
    courseId?: number,
    e?: React.MouseEvent
  ) => {
    if (e) {
      e.stopPropagation();
    }

    // Get current completion status
    const isCurrentlyCompleted = completedAssignments.has(assignmentId);
    const newCompletionStatus = !isCurrentlyCompleted;

    // Optimistically update local state for immediate UI feedback
    setCompletedAssignments(prev => {
      const newSet = new Set(prev);
      if (newCompletionStatus) {
        newSet.add(assignmentId);
      } else {
        newSet.delete(assignmentId);
      }
      return newSet;
    });

    // Update localStorage immediately
    const stored = localStorage.getItem('completedAssignments');
    const completedAssignmentsSet = stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
    if (newCompletionStatus) {
      completedAssignmentsSet.add(assignmentId);
    } else {
      completedAssignmentsSet.delete(assignmentId);
    }
    localStorage.setItem('completedAssignments', JSON.stringify(Array.from(completedAssignmentsSet)));
    window.dispatchEvent(new CustomEvent('completedAssignmentsUpdated'));

    // Update Supabase (single source of truth)
    try {
      await updateAssignmentCompletion(assignmentId, newCompletionStatus, courseId);
      // Success - integrations will be synced automatically by the backend
    } catch (error) {
      // Revert optimistic update on error
      setCompletedAssignments(prev => {
        const newSet = new Set(prev);
        if (isCurrentlyCompleted) {
          newSet.add(assignmentId);
        } else {
          newSet.delete(assignmentId);
        }
        return newSet;
      });

      // Revert localStorage
      const revertSet = stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
      localStorage.setItem('completedAssignments', JSON.stringify(Array.from(revertSet)));
      window.dispatchEvent(new CustomEvent('completedAssignmentsUpdated'));

      console.error('Error updating assignment completion:', error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Failed to update assignment completion status.",
        variant: "destructive",
      });
    }
  }, [completedAssignments]);

  /**
   * Check if an assignment is completed
   */
  const isAssignmentComplete = useCallback((assignmentId: number, submissionStatus?: "yes" | "no" | null) => {
    return completedAssignments.has(assignmentId) || submissionStatus === "yes";
  }, [completedAssignments]);

  return {
    completedAssignments,
    toggleAssignmentComplete,
    isAssignmentComplete,
  };
}
