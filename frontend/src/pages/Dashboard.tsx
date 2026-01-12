import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Layout from "@/components/Layout";
import { WelcomeHeader } from "@/components/dashboard/WelcomeHeader";
import { WeeklyCalendar } from "@/components/dashboard/WeeklyCalendar";
import { ActiveClasses } from "@/components/dashboard/ActiveClasses";
import { SemesterProgress } from "@/components/dashboard/SemesterProgress";
import { DueToday } from "@/components/dashboard/DueToday";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { useCanvasData } from "@/hooks/useCanvasData";
import { useAssignmentCompletion } from "@/hooks/useAssignmentCompletion";
import { sessionStorage } from "@/storage/session";
import { userDatabase } from "@/services/database/userDatabase";
import { getPreferences, applyTheme, applyFont } from "@/lib/preferences";
import type { User } from "@/services/mockApi/types";
import { cn } from "@/lib/utils";
import { useSidebar, SidebarViewer } from "@/components/SidebarViewer";

const Dashboard = () => {
  const { data: canvasData, loading: dataLoading } = useCanvasData();
  const { openItem: openSidebarItem, isOpen: isSidebarOpen, sidebarWidth, isFullscreen } = useSidebar();
  const [userName, setUserName] = useState("Student");
  const [user, setUser] = useState<User | null>(null);
  const [currentWeek, setCurrentWeek] = useState(0);
  
  // Use the assignment completion hook (updates Supabase - single source of truth)
  const { completedAssignments, toggleAssignmentComplete, isAssignmentComplete } = useAssignmentCompletion();
  const [selectedDay, setSelectedDay] = useState<{
    day: string;
    date: number;
    assignments: Array<{
      id: number;
      title: string;
      courseCode: string;
      dueAt: string;
      pointsPossible?: number;
      workflowState?: string;
    }>;
    fullDate: Date;
  } | null>(null);
  
  // Clear selected day when week changes
  useEffect(() => {
    setSelectedDay(null);
  }, [currentWeek]);

  // Apply theme preferences
  useEffect(() => {
    const prefs = getPreferences();
    applyTheme(prefs.theme);
    applyFont(prefs.font);
  }, []);

  // Check session on mount and set user
  useEffect(() => {
    async function loadUser() {
      const session = await sessionStorage.getSession();
      
      if (!session) {
        const isValid = await sessionStorage.hasValidSession();
        if (!isValid) {
          // Session invalid - RouteGuard will handle showing auth message
          return;
        }
      }

      if (session) {
        // Get user from Supabase via backend API (not localStorage)
        let currentUser = null;
        if (session.email) {
          currentUser = await userDatabase.getUserByEmail(session.email);
        }
        if (!currentUser) {
          currentUser = await userDatabase.getUser(session.userId);
        }

        if (currentUser) {
          setUser(currentUser);
          // Use first name from sign-up, fallback to student identikey if needed
          const displayName = currentUser.firstName ||
                             currentUser.student ||
                             'Student';
          setUserName(displayName);
        } else {
          // User not found - RouteGuard will handle showing auth message
          console.warn('[Dashboard] User not found for session');
        }
      }
    }
    
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show loading state
  if (dataLoading || !canvasData) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Clock className="w-8 h-8 animate-spin mx-auto mb-4 text-foreground" />
            <p className="text-muted-foreground">Loading your Canvas data...</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Generate weekly calendar data
  const weekData = (() => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + (currentWeek * 7));
    startOfWeek.setHours(0, 0, 0, 0);

    return days.map((day, index) => {
      const currentDay = new Date(startOfWeek);
      currentDay.setDate(startOfWeek.getDate() + index);
      currentDay.setHours(0, 0, 0, 0);
      const isToday = currentDay.toDateString() === today.toDateString();
      const isPast = currentDay.getTime() < today.getTime();
      
      const assignmentsForDay = canvasData.assignments
        .filter(assignment => {
          const dueDate = new Date(assignment.dueAt);
          dueDate.setHours(0, 0, 0, 0);
          const dateMatches = dueDate.getTime() === currentDay.getTime();
          
          // For past dates, show all assignments (pending, submitted, graded)
          // For today and future dates, only show pending assignments
          if (isPast) {
            return dateMatches;
          } else {
            return dateMatches && assignment.workflowState === "pending";
          }
        })
        .map(assignment => ({
          id: assignment.id,
          title: assignment.title,
          courseCode: assignment.courseCode,
          dueAt: assignment.dueAt,
          pointsPossible: assignment.pointsPossible,
          workflowState: assignment.workflowState,
        }));

      return {
        day,
        date: currentDay.getDate(),
        assignments: assignmentsForDay,
        isToday,
        fullDate: currentDay,
      };
    });
  })();

  // Get month string for calendar
  const getMonthString = () => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + (currentWeek * 7));
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const startMonth = monthNames[startOfWeek.getMonth()];
    const endMonth = monthNames[endOfWeek.getMonth()];
    const startDay = startOfWeek.getDate();
    const endDay = endOfWeek.getDate();
    
    if (startMonth === endMonth) {
      return `${startMonth} ${startDay} - ${endDay}`;
    }
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
  };

  // Generate active classes
  const activeClasses = canvasData.courses
    .filter(course => course.workflowState === "available")
    .map(course => ({
      id: course.id,
      code: course.code,
      details: course.name,
    }));

  // Calculate semester progress based on CU Boulder dates
  const calculateSemesterProgress = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();
    
    // 1st semester: August 21st to December 12th
    const firstSemesterStart = new Date(currentYear, 7, 21); // August (month 7)
    const firstSemesterEnd = new Date(currentYear, 11, 12); // December (month 11)
    
    // 2nd semester: January 8th to May 1st
    const secondSemesterStart = new Date(currentYear, 0, 8); // January (month 0)
    const secondSemesterEnd = new Date(currentYear, 4, 1); // May (month 4)
    
    // Check if we're in first semester
    if (today >= firstSemesterStart && today <= firstSemesterEnd) {
      const totalDays = Math.ceil((firstSemesterEnd.getTime() - firstSemesterStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysElapsed = Math.ceil((today.getTime() - firstSemesterStart.getTime()) / (1000 * 60 * 60 * 24));
      return Math.min(100, Math.round((daysElapsed / totalDays) * 100));
    }
    
    // Check if we're in second semester
    if (today >= secondSemesterStart && today <= secondSemesterEnd) {
      const totalDays = Math.ceil((secondSemesterEnd.getTime() - secondSemesterStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysElapsed = Math.ceil((today.getTime() - secondSemesterStart.getTime()) / (1000 * 60 * 60 * 24));
      return Math.min(100, Math.round((daysElapsed / totalDays) * 100));
    }
    
    // Not in a semester (break period)
    return null;
  };

  const semesterProgress = calculateSemesterProgress();
  const isOnBreak = semesterProgress === null;

  // Calculate due today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const dueToday = canvasData.assignments
    .filter(assignment => {
      const dueDate = new Date(assignment.dueAt);
      return dueDate >= today && dueDate < tomorrow && assignment.workflowState === "pending";
    })
    .map(assignment => {
      const course = canvasData.courses.find(c => c.id === assignment.courseId);
      const dueDate = new Date(assignment.dueAt);
      const isQuiz = assignment.isQuiz || assignment.submissionTypes?.some(type => type.includes("quiz")) || false;
      // Check if assignment is completed (either manually marked or submissionStatus === "yes")
      const isCompleted = isAssignmentComplete(assignment.id, assignment.submissionStatus);
      
      return {
        id: assignment.id,
        title: assignment.title,
        courseCode: assignment.courseCode || course?.code || '',
        courseName: assignment.courseName || course?.name || '',
        dueAt: assignment.dueAt,
        due: (() => {
          const month = dueDate.toLocaleDateString("en-US", { month: "short" });
          const day = dueDate.getDate();
          const time = dueDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          return `${month} ${day} at ${time}`;
        })(),
        type: isQuiz ? "Quiz" : "Assignment",
        points: assignment.pointsPossible,
        workflowState: assignment.workflowState,
        url: assignment.url,
        isCompleted: isCompleted,
        isMidterm: assignment.title.toLowerCase().includes("midterm"),
        isQuiz: isQuiz, // Include isQuiz flag for styling
      };
    })
    .sort((a, b) => {
      if (a.isCompleted && !b.isCompleted) return 1;
      if (!a.isCompleted && b.isCompleted) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });

  // Session is already validated by RouteGuard, so we can safely render
  // If we reach here, user is authenticated

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
              <header className="py-6 sm:py-8 border-b border-border flex items-start justify-between">
                <WelcomeHeader 
                  firstName={userName} 
                  tagline="Let's make today productive" 
                />
              </header>

              {/* Main Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[calc(100vh-160px)]">
                {/* Left Column */}
                <div className="lg:col-span-8 border-r border-border">
                  <div className="p-5 sm:p-8">
                    {/* Weekly Calendar with navigation */}
                    <div className="exposed-card glass-card  ">
                      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <button
                          onClick={() => setCurrentWeek(currentWeek - 1)}
                          className="fill-hover fill-hover-light h-8 w-8 border border-border flex items-center justify-center"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            Weekly View
                          </h2>
                          <span className="text-xs font-mono text-muted-foreground">{getMonthString()}</span>
                        </div>
                        <button
                          onClick={() => setCurrentWeek(currentWeek + 1)}
                          className="fill-hover fill-hover-light h-8 w-8 border border-border flex items-center justify-center"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <WeeklyCalendar 
                        days={weekData} 
                        month={getMonthString()} 
                        onDayClick={(day) => {
                          if (selectedDay && day && selectedDay.fullDate.getTime() === day.fullDate.getTime()) {
                            setSelectedDay(null);
                          } else {
                            setSelectedDay(day);
                          }
                        }}
                        selectedDay={selectedDay}
                      />

                      {/* Selected Day Assignments Section - Inside the same card for seamless look */}
                      <AnimatePresence>
                        {selectedDay && selectedDay.assignments.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0, y: -20 }}
                            animate={{ opacity: 1, height: "auto", y: 0 }}
                            exit={{ opacity: 0, height: 0, y: -20 }}
                            transition={{
                              duration: 0.3,
                              ease: [0.4, 0, 0.2, 1],
                            }}
                            className="overflow-hidden"
                          >
                            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                                {selectedDay.day}, {getMonthString().split(' - ')[0]} {selectedDay.date}
                              </h2>
                              <button
                                onClick={() => setSelectedDay(null)}
                                className="text-xs text-muted-foreground hover:text-foreground "
                              >
                                Close
                              </button>
                            </div>
                            <div className="p-5 space-y-0">
                              {selectedDay.assignments.map((assignment) => {
                                const formatTime = (dateString: string) => {
                                  const date = new Date(dateString);
                                  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                                };
                                
                                // Find the full assignment data from canvasData
                                const fullAssignment = canvasData.assignments.find(a => a.id === assignment.id);
                                const isQuiz = fullAssignment?.isQuiz || fullAssignment?.submissionTypes?.some(type => type.includes("quiz")) || false;
                                
                                // Check if assignment is completed (either manually marked, workflowState, or submissionStatus === "yes")
                                const isCompleted = assignment.workflowState !== "pending" || 
                                                   isAssignmentComplete(assignment.id, fullAssignment?.submissionStatus);
                                const dueDate = new Date(assignment.dueAt);
                                const formattedDue = (() => {
                                  const month = dueDate.toLocaleDateString("en-US", { month: "short" });
                                  const day = dueDate.getDate();
                                  const time = dueDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                                  return `${month} ${day} at ${time}`;
                                })();
                                
                                return (
                                  <div
                                    key={assignment.id}
                                    className={cn(
                                      "p-4 border hover:bg-white/5 cursor-pointer",
                                      isQuiz ? "border-2 border-red-500/80" : "border border-border",
                                      isCompleted && "opacity-60"
                                    )}
                                    onClick={() => {
                                      openSidebarItem({
                                        id: String(assignment.id),
                                        type: "assignment",
                                        title: assignment.title,
                                        subtitle: `${isQuiz ? "Quiz" : "Assignment"} ? ${assignment.courseCode}`,
                                        dueDate: formattedDue,
                                        points: assignment.pointsPossible,
                                        isCompleted: isCompleted,
                                        courseCode: assignment.courseCode,
                                        canvasUrl: fullAssignment?.url,
                                      });
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <p className={cn(
                                        "text-sm font-medium text-foreground/90 flex-1",
                                        isCompleted && "line-through"
                                      )}>
                                        {assignment.title}
                                      </p>
                                      {assignment.pointsPossible && (
                                        <span className="text-xs text-muted-foreground flex-shrink-0">
                                          {assignment.pointsPossible} pts
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                      <div className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        <span>{formatTime(assignment.dueAt)}</span>
                                      </div>
                                      {isCompleted && (
                                        <span className="text-xs text-muted-foreground/70">
                                          {assignment.workflowState === "submitted" ? "Submitted" : 
                                           assignment.workflowState === "graded" ? "Graded" : 
                                           "Completed"}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Old location of assignments section - Removed */}

                    <div className="mt-6">
                      <ActiveClasses classes={activeClasses} />
                    </div>
                  </div>
                </div>

                {/* Right Column */}
                <div className="lg:col-span-4">
                  <div className="p-5 sm:p-8 space-y-6">
                    <SemesterProgress 
                      percentage={semesterProgress ?? 0} 
                      message=""
                      isOnBreak={isOnBreak}
                    />
                    <DueToday 
                      assignments={dueToday} 
                      onToggleComplete={(assignmentId, e) => {
                        toggleAssignmentComplete(assignmentId, undefined, e);
                      }}
                      onOpenAssignment={(assignment) => {
                        openSidebarItem({
                          id: String(assignment.id),
                          type: "assignment",
                          title: assignment.title,
                          subtitle: `${assignment.type} ? ${assignment.courseCode}`,
                          dueDate: assignment.due,
                          points: assignment.points,
                          isCompleted: assignment.isCompleted,
                          courseCode: assignment.courseCode,
                          canvasUrl: assignment.url,
                        });
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Layout>
        </div>

      {/* Sidebar Viewer */}
      <SidebarViewer />
    </div>
  );
};

export default Dashboard;
