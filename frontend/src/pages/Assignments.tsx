import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Calendar as CalendarIcon,
  List,
  Clock,
  FileText,
  Rocket,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useCanvasData } from "@/hooks/useCanvasData";
import { useSidebar, SidebarViewer } from "@/components/SidebarViewer";
import IntegrationsPanel from "@/components/IntegrationsPanel";

const Assignments = () => {
  const navigate = useNavigate();
  const { data: mockCanvasData, loading } = useCanvasData();
  const {
    openItem: openSidebarItem,
    isOpen: isSidebarOpen,
    sidebarWidth,
    isFullscreen,
  } = useSidebar();
  const [daysBeforeToday, setDaysBeforeToday] = useState(0); // For infinite scroll loading previous days
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadingPreviousRef = useRef(false);

  // Sync completed assignments with localStorage
  const [completedAssignments, setCompletedAssignments] = useState<Set<number>>(
    () => {
      const stored = localStorage.getItem("completedAssignments");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    },
  );

  // Sync to localStorage whenever completedAssignments changes
  useEffect(() => {
    localStorage.setItem(
      "completedAssignments",
      JSON.stringify(Array.from(completedAssignments)),
    );
  }, [completedAssignments]);

  // Listen for completion changes from sidebar
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "completedAssignments" && e.newValue) {
        try {
          const newCompleted = new Set<number>(JSON.parse(e.newValue));
          setCompletedAssignments(newCompleted);
        } catch (error) {
          console.error("Error parsing completedAssignments:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    // Also listen for custom events (for same-window updates)
    const handleCustomStorage = () => {
      const stored = localStorage.getItem("completedAssignments");
      if (stored) {
        setCompletedAssignments(new Set(JSON.parse(stored)));
      }
    };

    window.addEventListener("completedAssignmentsUpdated", handleCustomStorage);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(
        "completedAssignmentsUpdated",
        handleCustomStorage,
      );
    };
  }, []);

  // Automatically mark assignments as completed if submissionStatus === "yes"
  useEffect(() => {
    if (!mockCanvasData || !mockCanvasData.assignments) return;

    setCompletedAssignments((prev) => {
      const newSet = new Set(prev);
      let hasChanges = false;

      mockCanvasData.assignments.forEach((assignment) => {
        if (
          assignment.submissionStatus === "yes" &&
          !newSet.has(assignment.id)
        ) {
          newSet.add(assignment.id);
          hasChanges = true;
        }
      });

      return hasChanges ? newSet : prev;
    });
  }, [mockCanvasData]);

  // Scroll detection for loading previous days
  useEffect(() => {
    const handleScroll = () => {
      if (loadingPreviousRef.current) return;

      // If scrolled near the top of the page (within 300px), load more previous days
      if (window.scrollY < 300) {
        loadingPreviousRef.current = true;

        // Load 7 more days before today
        setDaysBeforeToday((prev) => Math.min(prev + 7, 365)); // Cap at 1 year

        // Reset loading flag after a brief delay
        setTimeout(() => {
          loadingPreviousRef.current = false;
        }, 300);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  if (loading || !mockCanvasData) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <List className="w-8 h-8 animate-pulse mx-auto mb-4 text-foreground" />
            <p className="text-muted-foreground">Loading assignments...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Debug: Log quiz count
  const quizCount = mockCanvasData.assignments.filter(
    (a) => a.isQuiz || a.submissionTypes?.some((type) => type.includes("quiz")),
  ).length;
  console.log(
    `[Assignments] Total items: ${mockCanvasData.assignments.length}, Quizzes: ${quizCount}`,
  );
  if (quizCount > 0) {
    const quizTitles = mockCanvasData.assignments
      .filter(
        (a) =>
          a.isQuiz || a.submissionTypes?.some((type) => type.includes("quiz")),
      )
      .slice(0, 5)
      .map((a) => a.title);
    console.log(`[Assignments] Quiz titles found:`, quizTitles);
  }

  // Get assignments from mock data with full details
  const allAssignments = mockCanvasData.assignments.map((assignment) => {
    const course = mockCanvasData.courses.find(
      (c) => c.id === assignment.courseId,
    );
    let dueDate: Date;
    let hasValidDate = true;

    try {
      dueDate = new Date(assignment.dueAt);
      // Check if date is valid - empty string or invalid date should be treated as unknown
      if (
        !assignment.dueAt ||
        assignment.dueAt.trim() === "" ||
        isNaN(dueDate.getTime())
      ) {
        hasValidDate = false;
        dueDate = new Date(0); // Invalid date marker
      }
    } catch {
      hasValidDate = false;
      dueDate = new Date(0); // Invalid date marker
    }

    const createdDate = new Date(assignment.assignedAt);
    const isQuiz =
      assignment.isQuiz ||
      assignment.submissionTypes?.some((type) => type.includes("quiz")) ||
      false;

    // Check if assignment is completed (either manually marked or submissionStatus === "yes")
    const isCompleted =
      completedAssignments.has(assignment.id) ||
      assignment.submissionStatus === "yes";

    return {
      id: assignment.id,
      title: assignment.title,
      course: assignment.courseCode,
      courseName: course?.name || assignment.courseName,
      created: createdDate.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      due: hasValidDate
        ? dueDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "No due date",
      dueDate: dueDate,
      dueTime: hasValidDate
        ? dueDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : "",
      status:
        assignment.workflowState === "pending"
          ? "pending"
          : assignment.workflowState === "submitted"
            ? "submitted"
            : "graded",
      color: course?.color || "hsl(220, 45%, 48%)",
      points: assignment.pointsPossible,
      isQuiz,
      isCompleted,
      hasValidDate,
      url: assignment.url,
    };
  });

  // Group assignments by day for list view with infinite scroll support
  const { assignmentsByDay, unknownDateAssignments } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Separate assignments with valid dates and unknown dates
    const validAssignments: typeof allAssignments = [];
    const unknownDateAssignments: typeof allAssignments = [];

    allAssignments.forEach((assignment) => {
      if (!assignment.hasValidDate || isNaN(assignment.dueDate.getTime())) {
        unknownDateAssignments.push(assignment);
      } else {
        validAssignments.push(assignment);
      }
    });

    // Group valid assignments by date
    const groupedByDate = new Map<number, typeof allAssignments>();

    validAssignments.forEach((assignment) => {
      const dueDate = new Date(assignment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const dateKey = dueDate.getTime();

      if (!groupedByDate.has(dateKey)) {
        groupedByDate.set(dateKey, []);
      }
      groupedByDate.get(dateKey)!.push(assignment);
    });

    // Sort assignments within each day: incomplete first (chronologically), completed at bottom
    groupedByDate.forEach((assignments) => {
      assignments.sort((a, b) => {
        // Completed assignments always go to the bottom
        if (a.isCompleted && !b.isCompleted) return 1;
        if (!a.isCompleted && b.isCompleted) return -1;
        // Same completion status: sort by due time chronologically
        return a.dueDate.getTime() - b.dueDate.getTime();
      });
    });

    // Create day objects for each date
    const dayObjects: Array<{
      label: string;
      date: Date;
      assignments: typeof allAssignments;
      dateKey: number;
    }> = [];

    groupedByDate.forEach((assignments, dateKey) => {
      const date = new Date(dateKey);
      let label: string;

      if (dateKey === today.getTime()) {
        label = "Today";
      } else if (dateKey === tomorrow.getTime()) {
        label = "Tomorrow";
      } else {
        label = date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        });
      }

      dayObjects.push({
        label,
        date,
        assignments,
        dateKey,
      });
    });

    // Separate into past, today, and future
    const todayDay = dayObjects.find((d) => d.dateKey === today.getTime());
    const pastDays = dayObjects
      .filter((d) => d.dateKey < today.getTime())
      .sort((a, b) => b.dateKey - a.dateKey); // Most recent first
    const futureDays = dayObjects
      .filter((d) => d.dateKey > today.getTime())
      .sort((a, b) => a.dateKey - b.dateKey); // Chronological

    // Build the ordered list: past (limited by daysBeforeToday), today, future
    const result: Array<{
      label: string;
      date: Date;
      assignments: typeof allAssignments;
    }> = [];

    // Add past days (only show the number specified by daysBeforeToday)
    const pastDaysToShow = pastDays.slice(0, daysBeforeToday);
    pastDaysToShow.forEach((day) => {
      result.push({
        label: day.label,
        date: day.date,
        assignments: day.assignments,
      });
    });

    // Add today
    if (todayDay) {
      result.push({
        label: todayDay.label,
        date: todayDay.date,
        assignments: todayDay.assignments,
      });
    }

    // Add future days chronologically
    futureDays.forEach((day) => {
      result.push({
        label: day.label,
        date: day.date,
        assignments: day.assignments,
      });
    });

    return {
      assignmentsByDay: result,
      unknownDateAssignments,
    };
  }, [allAssignments, completedAssignments, daysBeforeToday]);

  // Scroll to today's assignments on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        // Find today's card
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayCard = container.querySelector('[data-day-card="today"]');
        if (todayCard) {
          todayCard.scrollIntoView({ behavior: "instant", block: "start" });
          // Scroll window to account for header
          window.scrollTo({ top: window.scrollY - 100, behavior: "instant" });
        }
      }, 150);
    }
  }, [assignmentsByDay]);

  const toggleAssignmentComplete = (
    assignmentId: number,
    e?: React.MouseEvent,
  ) => {
    if (e) {
      e.stopPropagation();
    }
    setCompletedAssignments((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(assignmentId)) {
        newSet.delete(assignmentId);
      } else {
        newSet.add(assignmentId);
      }
      return newSet;
    });
  };

  return (
    <div className="relative w-full">
      {/* Main Content Wrapper */}
      <div
        className="transition-all duration-150 ease-out max-lg:pr-0"
        style={{
          paddingRight: isSidebarOpen && !isFullscreen ? sidebarWidth : 0,
        }}
      >
        <Layout>
          <div className="px-5 sm:px-8 pb-10">
            {/* Header - Sticky */}
            <header className="sticky top-[73px] z-40 bg-background/95 backdrop-blur-sm py-6 sm:py-8 border-b border-border">
              {/* Header with title and description */}
              <div className="mb-6">
                <h1 className="page-header">Assignments</h1>
                <p className="page-header-subtitle">
                  Track and manage your coursework
                </p>
              </div>

              {/* Controls Row */}
              <div className="flex items-center justify-between">
                {/* Left side - empty for now */}
                <div className="flex-1"></div>

                {/* Right side - View Toggle */}
                <div className="flex-1 flex justify-end">
                  <div className="exposed-card glass-card flex items-center gap-2 px-3 py-2">
                    <CalendarIcon className="w-4 h-4 text-foreground/60" />
                    <Switch
                      checked={false}
                      onCheckedChange={() => navigate("/calendar")}
                    />
                    <List className="w-4 h-4 text-primary" />
                  </div>
                </div>
              </div>
            </header>

            {/* Integrations */}
            <div className="mt-4">
              <IntegrationsPanel />
            </div>

            {/* Assignments grouped by day with infinite scroll */}
            <div ref={scrollContainerRef} className="space-y-6">
              {assignmentsByDay.map((dayGroup, index) => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dayDate = new Date(dayGroup.date);
                dayDate.setHours(0, 0, 0, 0);
                const isToday = dayDate.getTime() === today.getTime();

                return (
                  <div
                    key={`${dayGroup.label}-${dayGroup.date.getTime()}`}
                    data-day-card={isToday ? "today" : ""}
                  >
                    <div className="exposed-card glass-card mb-4">
                      <div className="px-5 py-4 border-b border-border">
                        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                          {dayGroup.label === "Today"
                            ? `Today, ${dayGroup.date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
                            : dayGroup.label === "Tomorrow"
                              ? `Tomorrow, ${dayGroup.date.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
                              : dayGroup.label}
                        </h2>
                      </div>
                      <div className="p-5">
                        <div className="space-y-2">
                          {dayGroup.assignments.map((assignment) => (
                            <div
                              key={assignment.id}
                              className={`flex items-center gap-4 p-4 border bg-white/5 hover:bg-white/10 cursor-pointer ${
                                assignment.isQuiz
                                  ? "border-2 border-red-500/80"
                                  : "border border-border"
                              } ${assignment.isCompleted ? "opacity-60" : ""}`}
                              onClick={() => {
                                openSidebarItem({
                                  id: String(assignment.id),
                                  type: "assignment",
                                  title: assignment.title,
                                  subtitle: `${assignment.isQuiz ? "Quiz" : "Assignment"} • ${assignment.course}`,
                                  dueDate: assignment.dueTime
                                    ? `DUE: ${assignment.dueTime}`
                                    : assignment.due,
                                  points: assignment.points,
                                  isCompleted: assignment.isCompleted,
                                  courseCode: assignment.course,
                                  canvasUrl: assignment.url,
                                });
                              }}
                            >
                              {/* Course Code */}
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {assignment.course}
                              </span>

                              {/* Checkbox */}
                              <Checkbox
                                checked={assignment.isCompleted}
                                onCheckedChange={() =>
                                  toggleAssignmentComplete(assignment.id)
                                }
                                onClick={(e) => e.stopPropagation()}
                                className="flex-shrink-0"
                              />

                              {/* Icons */}
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {assignment.isQuiz ? (
                                  <Rocket className="w-4 h-4 text-foreground/60" />
                                ) : (
                                  <FileText className="w-4 h-4 text-foreground/60" />
                                )}
                              </div>

                              {/* Description */}
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`font-medium text-sm ${assignment.isCompleted ? "line-through text-foreground/50" : "text-foreground/90"}`}
                                >
                                  {assignment.course}{" "}
                                  {assignment.isQuiz ? "QUIZ" : "ASSIGNMENT"}{" "}
                                  {assignment.title}
                                </p>
                              </div>

                              {/* Points */}
                              <span className="text-sm text-foreground/70 flex-shrink-0">
                                {assignment.points} PTS
                              </span>

                              {/* Due Time */}
                              {assignment.dueTime && (
                                <div className="flex items-center gap-1 text-sm text-foreground/70 flex-shrink-0">
                                  <span>DUE: {assignment.dueTime}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Unknown date assignments at the bottom */}
              {unknownDateAssignments.length > 0 && (
                <div className="exposed-card glass-card mb-4">
                  <div className="px-5 py-4 border-b border-border">
                    <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Unknown Date
                    </h2>
                  </div>
                  <div className="p-5">
                    <div className="space-y-2">
                      {unknownDateAssignments.map((assignment) => (
                        <div
                          key={assignment.id}
                          className={`flex items-center gap-4 p-4 border bg-white/5 hover:bg-white/10 cursor-pointer ${
                            assignment.isQuiz
                              ? "border-2 border-red-500/80"
                              : "border border-border"
                          } ${assignment.isCompleted ? "opacity-60" : ""}`}
                          onClick={() => {
                            openSidebarItem({
                              id: String(assignment.id),
                              type: "assignment",
                              title: assignment.title,
                              subtitle: `${assignment.isQuiz ? "Quiz" : "Assignment"} • ${assignment.course}`,
                              dueDate: "No due date",
                              points: assignment.points,
                              isCompleted: assignment.isCompleted,
                              courseCode: assignment.course,
                              canvasUrl: assignment.url,
                            });
                          }}
                        >
                          {/* Course Code */}
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {assignment.course}
                          </span>

                          {/* Checkbox */}
                          <Checkbox
                            checked={assignment.isCompleted}
                            onCheckedChange={() =>
                              toggleAssignmentComplete(assignment.id)
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          />

                          {/* Icons */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {assignment.isQuiz ? (
                              <Rocket className="w-4 h-4 text-foreground/60" />
                            ) : (
                              <FileText className="w-4 h-4 text-foreground/60" />
                            )}
                          </div>

                          {/* Description */}
                          <div className="flex-1 min-w-0">
                            <p
                              className={`font-medium text-sm ${assignment.isCompleted ? "line-through text-foreground/50" : "text-foreground/90"}`}
                            >
                              {assignment.course}{" "}
                              {assignment.isQuiz ? "QUIZ" : "ASSIGNMENT"}{" "}
                              {assignment.title}
                            </p>
                          </div>

                          {/* Points */}
                          <span className="text-sm text-foreground/70 flex-shrink-0">
                            {assignment.points} PTS
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Layout>
      </div>

      {/* Sidebar Viewer */}
      <SidebarViewer />
    </div>
  );
};

export default Assignments;
