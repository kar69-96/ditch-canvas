import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { User } from "@/services/mockApi/types";
import { useBuffAnimation } from "./useBuffAnimation";
import "./BuffMascot.css";

interface BuffMascotProps {
  user: User | null;
}

/**
 * CU Boulder Buff mascot animation component.
 * Displays a pixelated buff that runs across the screen on first login,
 * then stands at the end position on subsequent visits.
 */
export function BuffMascot({ user }: BuffMascotProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const {
    shouldAnimate,
    animationPhase,
    hasPlayed,
    isCUBoulder,
    markAsPlayed,
    setAnimationPhase,
  } = useBuffAnimation(user);

  // Measure container width for animation end position
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Don't render anything for non-CU Boulder users
  if (!isCUBoulder) {
    return null;
  }

  // Calculate final position (with some padding from the right edge)
  const finalPosition = Math.max(containerWidth - 140, 100);
  const startPosition = -100; // Start off-screen left

  // Handle animation completion - transition from running to standing
  const handleRunComplete = () => {
    setAnimationPhase("standing");
    markAsPlayed();
  };

  // If animation already played, show standing buff at final position
  if (hasPlayed && !shouldAnimate) {
    return (
      <div ref={containerRef} className="buff-container">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="buff-sprite buff-standing"
          style={{ transform: `translateX(${finalPosition}px)` }}
        />
      </div>
    );
  }

  // Show animated buff
  return (
    <div ref={containerRef} className="buff-container">
      <AnimatePresence>
        {animationPhase !== "idle" && (
          <motion.div
            initial={{ x: startPosition, opacity: 1 }}
            animate={{
              x: finalPosition,
              opacity: 1,
            }}
            transition={{
              x: {
                duration: 2.5,
                ease: [0.25, 0.1, 0.25, 1], // Smooth easing for natural movement
              },
              opacity: { duration: 0.2 },
            }}
            onAnimationComplete={handleRunComplete}
            className={
              animationPhase === "running"
                ? "buff-sprite buff-running buff-facing-right"
                : "buff-sprite buff-standing"
            }
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default BuffMascot;
