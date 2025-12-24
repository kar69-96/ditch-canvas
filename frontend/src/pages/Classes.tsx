import Layout from "@/components/Layout";
import GlassCard from "@/components/GlassCard";
import { useNavigate } from "react-router-dom";
import { useCanvasData } from "@/hooks/useCanvasData";
import { BookOpen, User } from "lucide-react";

const Classes = () => {
  const navigate = useNavigate();
  const { data: canvasData, loading } = useCanvasData();

  if (loading || !canvasData) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <BookOpen className="w-8 h-8 animate-pulse mx-auto mb-4 text-foreground" />
            <p className="text-muted-foreground">Loading classes...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const enrolledClasses = canvasData.courses.filter(
    (course) => course.workflowState === "available"
  );

  return (
    <Layout>
      <div className="px-5 sm:px-8 pb-10">
        {/* Header */}
        <header className="py-6 sm:py-8 border-b border-border mb-8">
          <h1 className="page-header">My Classes</h1>
          <p className="page-header-subtitle">Select a class to view details</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {enrolledClasses.map((course, index) => {
            const courseAssignments = canvasData.assignments.filter(
              (assignment) => assignment.courseId === course.id && assignment.workflowState === "pending"
            );
            const courseAnnouncements = canvasData.announcements.filter(
              (announcement) => announcement.courseId === course.id
            );

            return (
              <GlassCard
                key={course.id}
                className="cursor-pointer fill-hover fill-hover-light"
                onClick={() => navigate(`/courses/${course.id}`)}
              >
                <div className="space-y-4">
                  {/* Course Header */}
                  <div className="flex items-start gap-4">
                    <span className="text-xs text-muted-foreground w-6 pt-1">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-semibold text-foreground/90 mb-1">{course.code}</h2>
                      <p className="text-sm text-foreground/70 line-clamp-2">{course.name}</p>
                    </div>
                  </div>

                  {/* Instructor */}
                  <div className="flex items-center gap-2 text-sm text-foreground/60">
                    <User className="w-4 h-4" />
                    <span>{course.instructor}</span>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 pt-2 border-t border-border">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-foreground/50" />
                      <span className="text-xs text-foreground/60">
                        {courseAssignments.length} {courseAssignments.length === 1 ? "assignment" : "assignments"}
                      </span>
                    </div>
                    {courseAnnouncements.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground/60">
                          {courseAnnouncements.length} {courseAnnouncements.length === 1 ? "announcement" : "announcements"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </div>
    </Layout>
  );
};

export default Classes;
