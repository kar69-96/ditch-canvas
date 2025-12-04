import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Clock } from "lucide-react";
import { motion } from "framer-motion";

interface DayAssignment {
  id: number;
  title: string;
  courseCode: string;
  dueAt: string;
  pointsPossible?: number;
  workflowState?: string;
}

interface DayData {
  day: string;
  date: number;
  assignments: DayAssignment[];
  isToday?: boolean;
  fullDate: Date;
}

interface WeeklyCalendarProps {
  days: DayData[];
  month: string;
  onDayClick?: (day: DayData | null) => void;
  selectedDay?: DayData | null;
}

export function WeeklyCalendar({ days, month, onDayClick, selectedDay }: WeeklyCalendarProps) {
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null);
  
  const isDaySelected = (day: DayData) => {
    if (!selectedDay) return false;
    return day.fullDate.getTime() === selectedDay.fullDate.getTime();
  };

  // Determine which day should show the black fill (selected > today, always visible)
  const getFilledDayIndex = () => {
    // If a day is selected, use that
    if (selectedDay) {
      const selectedIndex = days.findIndex(d => d.fullDate.getTime() === selectedDay.fullDate.getTime());
      if (selectedIndex >= 0) return selectedIndex;
    }
    
    // Otherwise, use today (always ensure there's a filled day)
    const todayIndex = days.findIndex(d => d.isToday);
    return todayIndex >= 0 ? todayIndex : null;
  };

  const filledDayIndex = getFilledDayIndex();
  
  // Determine which day should show the animated outline indicator (only on hover)
  const hoverDayIndex = hoveredDayIndex;

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="exposed-card  ">
      <div className="grid grid-cols-7 relative">
        {days.map((day, i) => {
          const hasAssignments = day.assignments.length > 0;
          const isFilled = filledDayIndex === i;
          const isHovered = hoverDayIndex === i;
          
          return (
            <Popover 
              key={i} 
              open={hoveredDay === i}
              onOpenChange={(open) => setHoveredDay(open ? i : null)}
            >
              <PopoverTrigger asChild>
                <div
                  onClick={() => {
                    if (onDayClick) {
                      onDayClick(day);
                    }
                  }}
                  onMouseEnter={() => {
                    setHoveredDayIndex(i);
                    if (hasAssignments) {
                      setHoveredDay(i);
                    }
                  }}
                  onMouseLeave={() => {
                    setHoveredDayIndex(null);
                    setHoveredDay(null);
                  }}
                  className="flex flex-col items-center py-5 px-2 relative cursor-pointer"
                >
                  {/* Vercel-style sliding black fill indicator - animates between days */}
                  {isFilled && (
                    <motion.div
                      layoutId="dayFillIndicator"
                      className="absolute inset-0 bg-foreground"
                      initial={false}
                      transition={{
                        type: "tween",
                        duration: 0.1,
                        ease: "easeOut"
                      }}
                    />
                  )}
                  
                  {/* Vercel-style sliding underline indicator - only on hover */}
                  {isHovered && (
                    <motion.div
                      layoutId="dayUnderlineIndicator"
                      className="absolute bottom-0 left-0 right-0 h-[3px] bg-foreground z-10"
                      initial={false}
                      transition={{
                        type: "tween",
                        duration: 0.1,
                        ease: "easeOut"
                      }}
                    />
                  )}
                  
                  <span className={cn(
                    "text-[10px] uppercase tracking-wider mb-2 relative z-10",
                    isFilled && "text-background",
                    !isFilled && "text-muted-foreground"
                  )}>
                    {day.day.slice(0, 3)}
                  </span>
                  <span className={cn(
                    "text-xl font-medium relative z-10",
                    isFilled && "text-background",
                    !isFilled && "text-foreground"
                  )}>
                    {day.date}
                  </span>
                  
                  {/* Outline for today - always visible */}
                  {day.isToday && (
                    <div className="absolute inset-0 border-2 border-foreground z-10" />
                  )}
                  <span className={cn(
                    "mt-2 text-xs relative z-10",
                    isFilled && "text-background",
                    !isFilled && "text-muted-foreground"
                  )}>
                    {day.assignments.length === 0 ? "—" : day.assignments.length}
                  </span>
                </div>
              </PopoverTrigger>
              
              {hasAssignments && (
                <PopoverContent 
                  className="w-80 p-0 bg-background/95 backdrop-blur-xl border-border"
                  align="start"
                  side="bottom"
                >
                  <div className="p-4 border-b border-border">
                    <h3 className="text-sm font-semibold text-foreground/90">
                      {day.day}, {month.split(' – ')[0]} {day.date}
                    </h3>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {day.assignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="p-4 border-b border-border last:border-b-0 hover:bg-white/5 "
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-medium text-foreground/90 flex-1">
                            {assignment.title}
                          </p>
                          {assignment.pointsPossible && (
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {assignment.pointsPossible} pts
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{assignment.courseCode}</span>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{formatTime(assignment.dueAt)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              )}
            </Popover>
          );
        })}
      </div>
    </div>
  );
}
