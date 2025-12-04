import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "@/components/Layout";
import GlassCard from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Eye, Upload, Calendar as CalendarIcon, List, Clock, FileText, Rocket } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useCanvasData } from "@/hooks/useCanvasData";

const Calendar = ({ defaultView }: { defaultView?: "calendar" | "assignments" }) => {
  const [searchParams] = useSearchParams();
  const queryView = searchParams.get('view') as "calendar" | "assignments" | null;
  const [viewMode, setViewMode] = useState<"calendar" | "assignments">(queryView || defaultView || "calendar");
  const { data: mockCanvasData, loading } = useCanvasData();
  
  // Update view mode when query parameter changes
  useEffect(() => {
    if (queryView) {
      setViewMode(queryView);
    }
  }, [queryView]);
  const [calendarView, setCalendarView] = useState<"day" | "week" | "month">("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  
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
    const dueDate = new Date(assignment.dueAt);
    const createdDate = new Date(assignment.assignedAt);
    const isQuiz = assignment.submissionTypes?.some(type => type.includes("quiz")) || false;
    
    return {
      id: assignment.id,
      title: assignment.title,
      course: assignment.courseCode,
      courseName: course?.name || assignment.courseName,
      created: createdDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      due: dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      dueDate: dueDate,
      dueTime: dueDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      status: assignment.workflowState === "pending" ? "pending" : 
              assignment.workflowState === "submitted" ? "submitted" : "graded",
      color: course?.color || "hsl(220, 45%, 48%)",
      points: assignment.pointsPossible,
      isQuiz,
      isCompleted: completedAssignments.has(assignment.id),
    };
  });

  // For table view (keep original assignments array)
  const assignments = allAssignments.map(a => ({
    id: a.id,
    title: a.title,
    course: a.course,
    courseName: a.courseName,
    created: a.created,
    due: a.due,
    status: a.status,
    color: a.color,
  }));

  // Group assignments by day for list view
  const assignmentsByDay = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

    const grouped: { [key: string]: typeof allAssignments } = {};

    allAssignments.forEach(assignment => {
      const dueDate = new Date(assignment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      
      let dayLabel: string;
      if (dueDate.getTime() === today.getTime()) {
        dayLabel = "Today";
      } else if (dueDate.getTime() === tomorrow.getTime()) {
        dayLabel = "Tomorrow";
      } else {
        dayLabel = dueDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      }

      if (!grouped[dayLabel]) {
        grouped[dayLabel] = [];
      }
      grouped[dayLabel].push(assignment);
    });

    // Sort assignments within each day by due time
    Object.keys(grouped).forEach(day => {
      grouped[day].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    });

    // Sort days chronologically
    const sortedDays = Object.keys(grouped).sort((a, b) => {
      const dateA = a === "Today" ? today : a === "Tomorrow" ? tomorrow : new Date(grouped[a][0].dueDate);
      const dateB = b === "Today" ? today : b === "Tomorrow" ? tomorrow : new Date(grouped[b][0].dueDate);
      return dateA.getTime() - dateB.getTime();
    });

    return sortedDays.map(day => ({
      label: day,
      date: day === "Today" ? today : day === "Tomorrow" ? tomorrow : new Date(grouped[day][0].dueDate),
      assignments: grouped[day],
    }));
  }, [allAssignments, completedAssignments]);

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

  const pendingCount = assignments.filter(a => a.status === "pending").length;
  const submittedCount = assignments.filter(a => a.status === "submitted").length;
  const gradedCount = assignments.filter(a => a.status === "graded").length;

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
        const isQuiz = assignment.submissionTypes?.some(type => type.includes("quiz")) || false;
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
    <Layout>
      <div className="px-5 sm:px-8 pb-10">
        {/* Header */}
        <header className="py-6 sm:py-8 border-b border-border">
          {/* Header with title and description */}
          <div className="mb-6">
            <h1 className="page-header">
              {viewMode === "calendar" ? monthName : "Assignments"}
            </h1>
            <p className="page-header-subtitle">
              {viewMode === "calendar" ? "Plan your academic journey" : "Track and manage your coursework"}
            </p>
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between">
            {/* Left side - empty for now */}
            <div className="flex-1"></div>

            {/* Center - Calendar navigation (only in calendar view) */}
            {viewMode === "calendar" && (
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
            )}

            {/* Right side - View Toggle (icons only) */}
            <div className="flex-1 flex justify-end">
              <div className="exposed-card glass-card flex items-center gap-2 px-3 py-2">
                <CalendarIcon 
                  className={`w-4 h-4  ${viewMode === "calendar" ? "text-primary" : "text-foreground/60"}`}
                />
                <Switch
                  checked={viewMode === "assignments"}
                  onCheckedChange={(checked) => setViewMode(checked ? "assignments" : "calendar")}
                />
                <List 
                  className={`w-4 h-4  ${viewMode === "assignments" ? "text-primary" : "text-foreground/60"}`}
                />
              </div>
            </div>
          </div>
        </header>

        {viewMode === "calendar" ? (
          <>
            {calendarView === "day" ? (
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
                          className={`flex items-center gap-4 p-4 border border-border bg-white/5 hover:bg-white/10  ${
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
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {[
                { label: "Pending", count: pendingCount, color: "hsl(34 53% 81%)" },
                { label: "Submitted", count: submittedCount, color: "hsl(210 50% 79%)" },
                { label: "Graded", count: gradedCount, color: "hsl(247 63% 85%)" },
              ].map((stat) => (
                <div key={stat.label} className="exposed-card glass-card text-center p-5">
                  <p className="text-xs text-muted-foreground mb-2">{stat.label}</p>
                  <p
                    className="text-3xl font-semibold text-foreground"
                    style={{ color: stat.color }}
                  >
                    {stat.count}
                  </p>
                </div>
              ))}
            </div>

            {/* Assignments grouped by day */}
            <div className="space-y-6">
              {assignmentsByDay.map((dayGroup) => (
                <div key={dayGroup.label}>
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
                        className={`flex items-center gap-4 p-4 border border-border bg-white/5 hover:bg-white/10  cursor-pointer ${
                          assignment.isCompleted ? "opacity-60" : ""
                        }`}
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
                        <div className="flex items-center gap-1 text-sm text-foreground/70 flex-shrink-0">
                          <span>DUE: {assignment.dueTime}</span>
                        </div>
                      </div>
                    ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default Calendar;
