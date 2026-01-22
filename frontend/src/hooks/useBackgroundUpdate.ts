/**
 * Hook for monitoring background Canvas data updates
 * Invalidates TanStack Query cache when updates complete so Dashboard refreshes immediately
 */

import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getUpdateStatus } from "@/services/api/auth";
import { sessionStorage } from "@/storage/session";
import { canvasDataKeys } from "./useCanvasData";
import { toast } from "@/hooks/use-toast";

interface UseBackgroundUpdateOptions {
  /** Whether to enable auto-monitoring on mount (default: true) */
  enabled?: boolean;
  /** Whether to show toast notifications (default: true) */
  showToast?: boolean;
}

interface UseBackgroundUpdateReturn {
  /** Manually start monitoring for update completion */
  startMonitoring: () => void;
  /** Stop monitoring */
  stopMonitoring: () => void;
}

export function useBackgroundUpdate(
  options: UseBackgroundUpdateOptions = {},
): UseBackgroundUpdateReturn {
  const { enabled = true, showToast = true } = options;
  const queryClient = useQueryClient();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const hasCompletedRef = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const stopMonitoring = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const checkStatus = useCallback(async () => {
    const email = sessionStorage.getEmail();
    if (!email) return;

    try {
      const status = await getUpdateStatus(email);
      console.log("[useBackgroundUpdate] Polling status:", status);

      if (status.status === "completed" && !hasCompletedRef.current) {
        hasCompletedRef.current = true;

        // KEY: Invalidate cache to trigger Dashboard refetch
        console.log(
          "[useBackgroundUpdate] ✅ Update COMPLETED! Invalidating cache for:",
          email,
        );
        await queryClient.invalidateQueries({
          queryKey: canvasDataKeys.user(email),
        });
        console.log(
          "[useBackgroundUpdate] ✅ Cache invalidated, Dashboard should refresh",
        );

        if (showToast) {
          toast({
            title: "Sync Complete",
            description: "Your Canvas data has been updated.",
          });
        }
        stopMonitoring();
      } else if (status.status === "failed") {
        console.log("[useBackgroundUpdate] ❌ Update FAILED:", status.error);
        if (showToast) {
          toast({
            title: "Sync Failed",
            description: status.error || "Failed to sync Canvas data.",
            variant: "destructive",
          });
        }
        stopMonitoring();
      } else if (status.status === "running" || status.hasActiveUpdate) {
        console.log("[useBackgroundUpdate] ⏳ Update still running...");
      }
    } catch (err) {
      console.warn("[useBackgroundUpdate] Error checking status:", err);
    }
  }, [queryClient, showToast, stopMonitoring]);

  const startMonitoring = useCallback(() => {
    if (pollingRef.current) {
      console.log("[useBackgroundUpdate] Already monitoring, skipping start");
      return;
    }

    console.log(
      "[useBackgroundUpdate] 🚀 Starting background update monitoring...",
    );
    hasCompletedRef.current = false;

    // Check immediately, then poll every 5 seconds
    checkStatus();
    pollingRef.current = setInterval(checkStatus, 5000);

    // Auto-stop after 5 minutes to prevent indefinite polling
    timeoutRef.current = setTimeout(
      () => {
        console.log(
          "[useBackgroundUpdate] Auto-stopping after 5 minute timeout",
        );
        stopMonitoring();
      },
      5 * 60 * 1000,
    );
  }, [checkStatus, stopMonitoring]);

  // Auto-start if enabled and there's an active update
  useEffect(() => {
    if (!enabled) return;

    const email = sessionStorage.getEmail();
    if (!email) return;

    // Check if there's an active update on mount
    getUpdateStatus(email)
      .then((status) => {
        if (status.hasActiveUpdate && !hasCompletedRef.current) {
          console.log(
            "[useBackgroundUpdate] Active update detected, starting monitoring",
          );
          startMonitoring();
        }
      })
      .catch(() => {
        // Silently ignore - update monitoring is non-critical
      });

    return stopMonitoring;
  }, [enabled, startMonitoring, stopMonitoring]);

  return { startMonitoring, stopMonitoring };
}
