import { useState, useEffect, useCallback } from "react";
import type { User } from "@/services/mockApi/types";

const STORAGE_KEY = "buff_animation_played";
const CU_BOULDER_SCHOOL = "University of Colorado - Boulder";

export type AnimationPhase =
  | "idle"
  | "running"
  | "stopping"
  | "turning"
  | "standing";

interface UseBuffAnimationReturn {
  /** Whether the animation should play (CU Boulder user who hasn't seen animation this session) */
  shouldAnimate: boolean;
  /** Current phase of the animation */
  animationPhase: AnimationPhase;
  /** Whether the animation has already played this session */
  hasPlayed: boolean;
  /** Whether the user is a CU Boulder student */
  isCUBoulder: boolean;
  /** Call this when the animation completes to mark it as played */
  markAsPlayed: () => void;
  /** Update the animation phase */
  setAnimationPhase: (phase: AnimationPhase) => void;
}

/**
 * Custom hook to manage the CU Boulder Buff mascot animation state.
 * Uses sessionStorage to ensure animation only plays once per browser session.
 */
export function useBuffAnimation(user: User | null): UseBuffAnimationReturn {
  const isCUBoulder = user?.school === CU_BOULDER_SCHOOL;

  // Check if animation has already played this session
  const [hasPlayed, setHasPlayed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(STORAGE_KEY) === "true";
  });

  const [animationPhase, setAnimationPhase] = useState<AnimationPhase>("idle");

  // Determine if we should animate
  const shouldAnimate = isCUBoulder && !hasPlayed;

  // Start animation when component mounts and should animate
  useEffect(() => {
    if (shouldAnimate && animationPhase === "idle") {
      // Small delay to let the page settle before starting animation
      const timer = setTimeout(() => {
        setAnimationPhase("running");
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [shouldAnimate, animationPhase]);

  const markAsPlayed = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, "true");
    }
    setHasPlayed(true);
    setAnimationPhase("standing");
  }, []);

  return {
    shouldAnimate,
    animationPhase,
    hasPlayed,
    isCUBoulder,
    markAsPlayed,
    setAnimationPhase,
  };
}
