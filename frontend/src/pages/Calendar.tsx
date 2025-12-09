import { useState, useMemo, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Layout from "@/components/Layout";
import GlassCard from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, List, Clock, FileText, Rocket } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useCanvasData } from "@/hooks/useCanvasData";
import { useSidebar, SidebarViewer } from "@/components/SidebarViewer";

const Calendar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: mockCanvasData, loading } = useCanvasData();
  const { openItem: openSidebarItem, isOpen: isSidebarOpen, sidebarWidth, isFullscreen } = useSidebar();
  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [daysBeforeToday, setDaysBeforeToday] = useState(7); // For infinite scroll loading previous days - start with 7 days
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadingPreviousRef = useRef(false);
  
  // Determine if we're in list view or grid view based on URL
  const isListView = location.pathname === '/calendar/list';
  const isGridView = location.pathname === '/calendar/grid' || location.pathname === '/calendar';
  
  // Sync completed assignments with localStorage
  const [completedAssignments, setCompletedAssignments] = useState<Set<number>>(() => {
    const stored = localStorage.getItem('completedAssignments');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });
  
  // Sync to localStorage whenever completedAssignments changes
  useEffect(() => {
    localStorage.setItem('completedAssignments', JSON.stringify(Array.from(completedAssignments)));
  }, [completedAssignments]);

  // Listen for completion changes from sidebar
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

  // Automatically mark assignments as completed if submissionStatus === "yes"
  useEffect(() => {
    if (!mockCanvasData || !mockCanvasData.assignments) return;
    
    setCompletedAssignments(prev => {
      const newSet = new Set(prev);
      let hasChanges = false;
      
      mockCanvasData.assignments.forEach(assignment => {
        if (assignment.submissionStatus === "yes" && !newSet.has(assignment.id)) {
          newSet.add(assignment.id);
          hasChanges = true;
        }
      });
      
      return hasChanges ? newSet : prev;
    });
  }, [mockCanvasData]);

  // Scroll detection for loading previous days (list view only)
  useEffect(() => {
    if (!isListView) return;

    const handleScroll = () => {
      if (loadingPreviousRef.current) return;

      // If scrolled near the top of the page (within 300px), load more previous days
      if (window.scrollY < 300) {
        loadingPreviousRef.current = true;
        
        // Load 7 more days before today
        setDaysBeforeToday(prev => Math.min(prev + 7, 365)); // Cap at 1 year
        
        // Reset loading flag after a brief delay
        setTimeout(() => {
          loadingPreviousRef.current = false;
        }, 300);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [isListView]);

  
  // Navigation handlers
  const handlePrevious = () => {
    const newDate = new Date(currentDate);
    if (calendarView === "day") {
      newDate.setDate(newDate.getDate() - 1);
    } else if (calendarView === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setMonth(newDate.getMonth() - 1);
    }
    setCurrentDate(newDate);
  };

  const handleNext = () => {
    const newDate = new Date(currentDate);
    if (calendarView === "day") {
      newDate.setDate(newDate.getDate() + 1);
    } else if (calendarView === "week") {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setMonth(newDate.getMonth() + 1);
    }
    setCurrentDate(newDate);
  };

  // Get title based on view
  const getTitle = () => {
    if (calendarView === "day") {
      return currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    } else if (calendarView === "week") {
      const startOfWeek = new Date(currentDate);
      startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return `${startOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endOfWeek.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    } else {
      return currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  };

  const monthName = getTitle();
  
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  
  const events = {
    5: [{ title: "CS 101 Quiz", type: "exam", color: "hsl(247 63% 85%)" }],
    12: [{ title: "Math Assignment Due", type: "assignment", color: "hsl(20 60% 83%)" }],
    15: [{ title: "Midterm Exam", type: "exam", color: "hsl(0 84.2% 60.2%)" }],
    20: [{ title: "Project Presentation", type: "class", color: "hsl(210 50% 79%)" }],
    28: [{ title: "Final Paper Due", type: "assignment", color: "hsl(20 60% 83%)" }],
  };

  const days = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  if (loading || !mockCanvasData) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <CalendarIcon className="w-8 h-8 animate-pulse mx-auto mb-4 text-foreground" />
            <p className="text-muted-foreground">Loading calendar...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Get assignments from mock data with full details
  const allAssignments = mockCanvasData.assignments.map((assignment) => {
    const course = mockCanvasData.courses.find(c => c.id === assignment.courseId);
    let dueDate: Date;
    let hasValidDate = true;
    
    try {
      dueDate = new Date(assignment.dueAt);
      // Check if date is valid
      if (isNaN(dueDate.getTime())) {
        hasValidDate = false;
        dueDate = new Date(0); // Invalid date marker
      }
    } catch {
      hasValidDate = false;
      dueDate = new Date(0); // Invalid date marker
    }
    
    const createdDate = new Date(assignment.assignedAt);
    const isQuiz = assignment.isQuiz || assignment.submissionTypes?.some(type => type.includes("quiz")) || false;
    
    // Check if assignment is completed (either manually marked or submissionStatus === "yes")
    const isCompleted = completedAssignments.has(assignment.id) || assignment.submissionStatus === "yes";
    
    return {
      id: assignment.id,
      title: assignment.title,
      course: assignment.courseCode,
      courseName: course?.name || assignment.courseName,
      created: createdDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      due: hasValidDate ? dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No due date",
      dueDate: dueDate,
      dueTime: hasValidDate ? dueDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
      status: assignment.workflowState === "pending" ? "pending" : 
              assignment.workflowState === "submitted" ? "submitted" : "graded",
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
    if (!isListView) {
      return { assignmentsByDay: [], unknownDateAssignments: [] };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Separate assignments with valid dates and unknown dates
    const validAssignments: typeof allAssignments = [];
    const unknownDateAssignments: typeof allAssignments = [];

    allAssignments.forEach(assignment => {
      if (!assignment.hasValidDate || isNaN(assignment.dueDate.getTime())) {
        unknownDateAssignments.push(assignment);
      } else {
        validAssignments.push(assignment);
      }
    });

    // Group valid assignments by date
    const groupedByDate = new Map<number, typeof allAssignments>();

    validAssignments.forEach(assignment => {
      const dueDate = new Date(assignment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const dateKey = dueDate.getTime();

      if (!groupedByDate.has(dateKey)) {
        groupedByDate.set(dateKey, []);
      }
      groupedByDate.get(dateKey)!.push(assignment);
    });

    // Sort assignments within each day by due time
    groupedByDate.forEach((assignments) => {
      assignments.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
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
        label = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      }

      dayObjects.push({
        label,
        date,
        assignments,
        dateKey,
      });
    });

    // Separate into past, today, and future
    const todayDay = dayObjects.find(d => d.dateKey === today.getTime());
    // Sort past days chronologically (oldest first) - earliest assignments at top
    const allPastDays = dayObjects.filter(d => d.dateKey < today.getTime()).sort((a, b) => a.dateKey - b.dateKey);
    // Sort future days chronologically (earliest first)
    const futureDays = dayObjects.filter(d => d.dateKey > today.getTime()).sort((a, b) => a.dateKey - b.dateKey);

    // Build the ordered list: past (oldest to newest), today, future (chronological)
    // This ensures earliest assignments at top, latest at bottom
    const result: Array<{
      label: string;
      date: Date;
      assignments: typeof allAssignments;
    }> = [];

    // Show past days: take the most recent N days (closest to today)
    // Since allPastDays is sorted oldest first, slice(-N) gets the most recent N days
    // which will still be in chronological order (oldest of those N days first)
    const pastDaysToShow = allPastDays.length > 0 
      ? allPastDays.slice(-Math.min(daysBeforeToday, allPastDays.length))
      : [];
    
    pastDaysToShow.forEach(day => {
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

    // Add future days chronologically (earliest first)
    futureDays.forEach(day => {
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
  }, [allAssignments, completedAssignments, daysBeforeToday, isListView]);

  // Scroll to today's assignments on mount (list view only)
  useEffect(() => {
    if (!isListView || !scrollContainerRef.current) return;
    
    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Find today's card
      const todayCard = container.querySelector('[data-day-card="today"]');
      if (todayCard) {
        // Get the position of today's card
        const cardRect = todayCard.getBoundingClientRect();
        const scrollOffset = window.scrollY + cardRect.top - 150; // Account for sticky header
        
        // Scroll to today's assignments (or closest if no today card exists)
        window.scrollTo({ top: scrollOffset, behavior: 'instant' });
      } else if (assignmentsByDay.length > 0) {
        // If no today card, scroll to the first assignment card (closest to today)
        const firstCard = container.querySelector('[data-day-card]');
        if (firstCard) {
          const cardRect = firstCard.getBoundingClientRect();
          const scrollOffset = window.scrollY + cardRect.top - 150;
          window.scrollTo({ top: scrollOffset, behavior: 'instant' });
        }
      }
    }, 200);
    
    return () => clearTimeout(timeoutId);
  }, [assignmentsByDay, isListView]);


  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-muted/30 text-muted-foreground border-muted/40";
      case "submitted":
        return "bg-secondary/30 text-secondary-foreground border-secondary/40";
      case "grading":
        return "bg-accent/30 text-accent-foreground border-accent/40";
      case "graded":
        return "bg-primary/30 text-primary-foreground border-primary/40";
      default:
        return "bg-white/10 text-foreground/80";
    }
  };

  // Day view: Get assignments for the selected day, sorted by due time
  const dayAssignments = useMemo(() => {
    const selectedDay = new Date(currentDate);
    selectedDay.setHours(0, 0, 0, 0);
    const nextDay = new Date(selectedDay);
    nextDay.setDate(nextDay.getDate() + 1);

    return mockCanvasData.assignments
      .filter(assignment => {
        const dueDate = new Date(assignment.dueAt);
        return dueDate >= selectedDay && dueDate < nextDay;
      })
      .map(assignment => {
        const course = mockCanvasData.courses.find(c => c.id === assignment.courseId);
        const dueDate = new Date(assignment.dueAt);
        const isQuiz = assignment.isQuiz || assignment.submissionTypes?.some(type => type.includes("quiz")) || false;
        return {
          id: assignment.id,
          title: assignment.title,
          course: assignment.courseCode,
          courseName: course?.name || assignment.courseName,
          due: dueDate,
          dueTime: dueDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
          status: assignment.workflowState === "pending" ? "pending" : 
                  assignment.workflowState === "submitted" ? "submitted" : "graded",
          color: course?.color || "hsl(220, 45%, 48%)",
          points: assignment.pointsPossible,
          isQuiz,
          isCompleted: completedAssignments.has(assignment.id),
        };
      })
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [currentDate, completedAssignments]);

  // Day view metrics
  const dayMetrics = useMemo(() => {
    const pending = dayAssignments.filter(a => a.status === "pending" && !a.isCompleted).length;
    const completed = dayAssignments.filter(a => a.isCompleted).length;
    const submitted = dayAssignments.filter(a => a.status === "submitted").length;
    const total = dayAssignments.length;
    return { pending, completed, submitted, total };
  }, [dayAssignments]);

  const toggleAssignmentComplete = (assignmentId: number, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setCompletedAssignments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(assignmentId)) {
        newSet.delete(assignmentId);
      } else {
        newSet.add(assignmentId);
      }
      return newSet;
    });
  };

  // Week view: Generate weekly data similar to dashboard
  const weekData = useMemo(() => {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return days.map((day, index) => {
      const currentDay = new Date(startOfWeek);
      currentDay.setDate(startOfWeek.getDate() + index);
      const nextDay = new Date(currentDay);
      nextDay.setDate(currentDay.getDate() + 1);
      
      const isToday = currentDay.getTime() === today.getTime();
      
      const assignmentsForDay = mockCanvasData.assignments
        .filter(assignment => {
          const dueDate = new Date(assignment.dueAt);
          return dueDate >= currentDay && dueDate < nextDay && assignment.workflowState === "pending";
        })
        .map(assignment => {
          const course = mockCanvasData.courses.find(c => c.id === assignment.courseId);
          return {
            title: assignment.title,
            course: assignment.courseCode,
            color: course?.color || "hsl(220, 70%, 50%)"
          };
        });

      return {
        day,
        date: currentDay.getDate(),
        isToday,
        assignments: assignmentsForDay
      };
    });
  }, [currentDate]);

  return (
    <div className="relative w-full">
      {/* Main Content Wrapper */}
      <div 
        className="transition-all duration-150 ease-out max-lg:pr-0"
        style={{ paddingRight: isSidebarOpen && !isFullscreen ? sidebarWidth : 0 }}
      >
        <Layout>
          <div className="px-5 sm:px-8 pb-10">
        {/* Header */}
        <header className="py-6 sm:py-8 border-b border-border">
          {/* Header with title and description */}
          <div className="mb-6">
            <h1 className="page-header">{monthName}</h1>
            <p className="page-header-subtitle">Plan your academic journey</p>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between">
            {/* Left side - empty for now */}
            <div className="flex-1"></div>

            {/* Center - Calendar navigation */}
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="glass-button "
                  onClick={handlePrevious}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Select value={calendarView} onValueChange={(value) => setCalendarView(value as "day" | "week" | "month")}>
                  <SelectTrigger className="glass-button  w-[120px] border-none bg-white/5 hover:bg-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="week">Week</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                  </SelectContent>
                </Select>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="glass-button "
                  onClick={handleNext}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

            {/* Right side - View Toggle (icons only) */}
            <div className="flex-1 flex justify-end">
              <div className="exposed-card glass-card flex items-center gap-2 px-3 py-2">
                <CalendarIcon className={`w-4 h-4 ${isGridView ? 'text-primary' : 'text-foreground/60'}`} />
                <Switch
                  checked={isListView}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      navigate('/calendar/list');
                    } else {
                      navigate('/calendar/grid');
                    }
                  }}
                />
                <List className={`w-4 h-4 ${isListView ? 'text-primary' : 'text-foreground/60'}`} />
              </div>
            </div>
          </div>
        </header>

          <>
            {isListView ? (
              // List View
              <div 
                ref={scrollContainerRef}
                className="space-y-6"
              >
                {assignmentsByDay.map((dayGroup, index) => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const dayDate = new Date(dayGroup.date);
                  dayDate.setHours(0, 0, 0, 0);
                  const isToday = dayDate.getTime() === today.getTime();
                  
                  return (
                    <div key={`${dayGroup.label}-${dayGroup.date.getTime()}`} data-day-card={isToday ? "today" : ""}>
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
                                  assignment.isQuiz ? "border-2 border-red-500/80" : "border border-border"
                                } ${
                                  assignment.isCompleted ? "opacity-60" : ""
                                }`}
                                onClick={() => {
                                  openSidebarItem({
                                    id: String(assignment.id),
                                    type: "assignment",
                                    title: assignment.title,
                                    subtitle: `${assignment.isQuiz ? "Quiz" : "Assignment"} • ${assignment.course}`,
                                    dueDate: assignment.dueTime ? `DUE: ${assignment.dueTime}` : assignment.due,
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
                                  onCheckedChange={() => toggleAssignmentComplete(assignment.id)}
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
                                  <p className={`font-medium text-sm ${assignment.isCompleted ? "line-through text-foreground/50" : "text-foreground/90"}`}>
                                    {assignment.course} {assignment.isQuiz ? "QUIZ" : "ASSIGNMENT"} {assignment.title}
                                  </p>
                                </div>

                                {/* Points */}
                                <span className="text-sm text-foreground/70 flex-shrink-0">{assignment.points} PTS</span>

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
                              assignment.isQuiz ? "border-2 border-red-500/80" : "border border-border"
                            } ${
                              assignment.isCompleted ? "opacity-60" : ""
                            }`}
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
                              onCheckedChange={() => toggleAssignmentComplete(assignment.id)}
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
                              <p className={`font-medium text-sm ${assignment.isCompleted ? "line-through text-foreground/50" : "text-foreground/90"}`}>
                                {assignment.course} {assignment.isQuiz ? "QUIZ" : "ASSIGNMENT"} {assignment.title}
                              </p>
                            </div>

                            {/* Points */}
                            <span className="text-sm text-foreground/70 flex-shrink-0">{assignment.points} PTS</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : calendarView === "day" ? (
              <>
                {/* Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: "Total", count: dayMetrics.total, color: "hsl(220, 70%, 50%)" },
                    { label: "Pending", count: dayMetrics.pending, color: "hsl(34 53% 81%)" },
                    { label: "Completed", count: dayMetrics.completed, color: "hsl(210 50% 79%)" },
                    { label: "Submitted", count: dayMetrics.submitted, color: "hsl(247 63% 85%)" },
                  ].map((stat) => (
                    <div key={stat.label} className="exposed-card glass-card text-center p-5">
                      <p className="text-xs text-muted-foreground mb-2">{stat.label}</p>
                      <p
                        className="text-2xl font-semibold text-foreground"
                        style={{ color: stat.color }}
                      >
                        {stat.count}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="exposed-card glass-card">
                  <div className="px-5 py-4 border-b border-border">
                    <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Schedule for {currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                    </h2>
                  </div>
                  <div className="p-5">
                  {dayAssignments.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-foreground/60 text-sm">No assignments due on this day</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {dayAssignments.map((assignment) => (
                        <div
                          key={assignment.id}
                          className={`flex items-center gap-4 p-4 border bg-white/5 hover:bg-white/10  ${
                            assignment.isQuiz ? "border-2 border-red-500/80" : "border border-border"
                          } ${
                            assignment.isCompleted ? "opacity-60" : ""
                          }`}
                        >
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {assignment.course.split(" ")[0]}
                          </span>
                          <Checkbox
                            checked={assignment.isCompleted}
                            onCheckedChange={() => toggleAssignmentComplete(assignment.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0"
                          />
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {assignment.isQuiz ? (
                              <Rocket className="w-4 h-4 text-foreground/60" />
                            ) : (
                              <FileText className="w-4 h-4 text-foreground/60" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium mb-1 ${assignment.isCompleted ? "line-through text-foreground/50" : "text-foreground/90"}`}>
                              {assignment.course} {assignment.isQuiz ? "QUIZ" : "ASSIGNMENT"} {assignment.title}
                            </p>
                            <p className="text-sm text-foreground/60">{assignment.courseName}</p>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-foreground/70">{assignment.points} PTS</span>
                            <div className="flex items-center gap-2 text-sm text-foreground/70">
                              <Clock className="w-4 h-4" />
                              <span>DUE: {assignment.dueTime}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </div>
              </>
            ) : calendarView === "week" ? (
              <div className="exposed-card glass-card">
                <div className="p-5">
                  <div className="grid grid-cols-7 gap-3">
                  {weekData.map(day => (
                    <div key={day.day} className="flex flex-col">
                      <div className="text-center mb-3">
                        <div className="text-xs text-foreground/50 mb-1">{day.day}</div>
                        <div className={`text-lg font-medium ${day.isToday ? "text-primary" : "text-foreground/90"}`}>
                          {day.date}
                        </div>
                      </div>
                      <div className="space-y-2 min-h-[200px]">
                        {day.assignments.length === 0 ? (
                          <div className="bg-white/5 h-full min-h-[60px] flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">No assignments</span>
                          </div>
                        ) : (
                          day.assignments.map((assignment, idx) => (
                            <div
                              key={idx}
                              className="p-3 border border-border cursor-pointer  hover:bg-secondary/20 bg-secondary/10"
                            >
                              <p className="text-xs font-semibold mb-1 text-foreground">
                                {assignment.course}
                              </p>
                              <p className="text-[11px] font-medium text-muted-foreground">
                                {assignment.title}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="exposed-card glass-card overflow-hidden">
                  <div className="p-5">
                    {/* Day Labels */}
                    <div className="grid grid-cols-7 gap-2 mb-4">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div key={day} className="text-center text-xs font-medium text-primary py-2">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar Grid */}
                  <div className="grid grid-cols-7 gap-2">
                    {days.map((day, index) => (
                      <div
                        key={index}
                        className={`aspect-square  p-2 flex flex-col items-start justify-start ${
                          day ? "bg-white/5 hover:bg-white/10 cursor-pointer " : ""
                        }`}
                      >
                        {day && (
                          <>
                            <span className="text-sm text-foreground/80 font-medium">{day}</span>
                            {events[day] && (
                              <div className="mt-auto w-full space-y-1">
                                {events[day].map((event, i) => (
                                  <div
                                    key={i}
                                    className="text-[10px] px-2 py-1 truncate border border-border bg-secondary/10 text-foreground"
                                  >
                                    {event.title}
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                    </div>
                  </div>
                </div>

                {/* Event Types Legend */}
                <div className="mt-6 flex items-center justify-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 " style={{ background: "hsl(247 63% 85%)" }} />
                    <span className="text-xs text-foreground/60">Exam</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 " style={{ background: "hsl(20 60% 83%)" }} />
                    <span className="text-xs text-foreground/60">Assignment</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 " style={{ background: "hsl(210 50% 79%)" }} />
                    <span className="text-xs text-foreground/60">Class</span>
                  </div>
                </div>
              </>
            )}
          </>
          </div>
        </Layout>
      </div>

      {/* Sidebar Viewer */}
      <SidebarViewer />
    </div>
  );
};

export default Calendar;
