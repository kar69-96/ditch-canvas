/**
 * CourseFilter Component
 * Dropdown to filter learn content by course
 */

import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCanvasData } from "@/hooks/useCanvasData";
import { BookOpen } from "lucide-react";

interface CourseFilterProps {
  selectedCourse: string | null;
  onCourseChange: (courseId: string | null) => void;
  className?: string;
}

export function CourseFilter({
  selectedCourse,
  onCourseChange,
  className = "",
}: CourseFilterProps) {
  const { courses, isLoading } = useCanvasData();
  const [value, setValue] = useState<string>(selectedCourse || "all");

  useEffect(() => {
    setValue(selectedCourse || "all");
  }, [selectedCourse]);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    onCourseChange(newValue === "all" ? null : newValue);
  };

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger className={`w-[280px] ${className}`}>
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="All Courses" />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Courses</SelectItem>
        {isLoading ? (
          <SelectItem value="loading" disabled>
            Loading courses...
          </SelectItem>
        ) : (
          courses?.map((course) => (
            <SelectItem key={course.id} value={String(course.id)}>
              {course.name || course.data?.name || `Course ${course.id}`}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

export default CourseFilter;
