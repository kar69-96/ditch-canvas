import { Check, Clock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { motion } from "framer-motion";
import { useState } from "react";

interface Assignment {
  id: number;
  title: string;
  courseCode: string;
  courseName?: string;
  dueAt: string;
  due: string;
  type: string;
  points?: number;
  workflowState?: string;
  url?: string;
  isCompleted: boolean;
  isMidterm?: boolean;
}

interface DueTodayProps {
  assignments: Assignment[];
  onToggleComplete: (assignmentId: number, e?: React.MouseEvent) => void;
  onOpenAssignment: (assignment: Assignment) => void;
}

export function DueToday({ assignments, onToggleComplete, onOpenAssignment }: DueTodayProps) {
  const total = assignments.length;
  const allDone = total === 0;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="exposed-card glass-card  ">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Due Today
        </h2>
      </div>
      
      {allDone ? (
        <div className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 border border-border flex items-center justify-center bg-secondary/20">
            <Check className="w-5 h-5 text-foreground" />
          </div>
          
          <div>
            <p className="text-lg font-medium text-foreground leading-none">
              All Clear
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              You're all caught up!
            </p>
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div 
            className={`space-y-2 ${
              assignments.length > 5 
                ? 'max-h-[400px] overflow-y-auto pr-2 fade-list' 
                : ''
            }`}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(255,255,255,0.2) transparent'
            }}
          >
            {assignments.map((assignment, index) => {
              const borderClass = (assignment.isMidterm || assignment.type === "Quiz") 
                ? "border-2 border-red-500/80" 
                : "";
              const isQuiz = assignment.type === "Quiz";
              const isHovered = hoveredIndex === index;
              
              return (
                <div
                  key={assignment.id}
                  data-sidebar-trigger
                  onClick={() => onOpenAssignment(assignment)}
                  onMouseEnter={() => setHoveredIndex(index)}
                  className={`p-3 cursor-pointer relative ${borderClass} ${
                    assignment.isCompleted ? "opacity-60" : ""
                  }`}
                >
                  {isHovered && (
                    <motion.div
                      layoutId="dueTodaySidebar"
                      className="absolute left-0 top-0 bottom-0 w-[3px] bg-foreground z-0"
                      initial={false}
                      transition={{
                        type: "tween",
                        duration: 0.1,
                        ease: "easeOut"
                      }}
                    />
                  )}
                  <div className="relative z-10">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={assignment.isCompleted}
                        onCheckedChange={() => {
                          onToggleComplete(assignment.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <p className={`text-sm font-medium ${
                            assignment.isCompleted ? "line-through text-foreground/50" : "text-foreground/90"
                          }`}>
                            {assignment.title}
                          </p>
                          <span className="text-[10px] px-2 py-1 bg-accent/30 text-accent-foreground flex-shrink-0 ml-2">
                            {assignment.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-foreground/60">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{assignment.due}</span>
                          </div>
                          {assignment.points && (
                            <span className="text-foreground/50">
                              {assignment.points} {assignment.points === 1 ? "point" : "points"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
