import Layout from "@/components/Layout";
import GlassCard from "@/components/GlassCard";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Eye, Upload } from "lucide-react";

const Assignments = () => {
  const assignments = [
    {
      title: "Data Structures Implementation",
      course: "CS 101",
      created: "Jan 1, 2025",
      due: "Jan 15, 2025",
      status: "pending",
    },
    {
      title: "Research Paper: AI Ethics",
      course: "CS 301",
      created: "Dec 28, 2024",
      due: "Jan 12, 2025",
      status: "pending",
    },
    {
      title: "Mathematical Proof Assignment",
      course: "MATH 201",
      created: "Jan 3, 2025",
      due: "Jan 18, 2025",
      status: "pending",
    },
    {
      title: "Technical Writing Exercise",
      course: "ENG 105",
      created: "Dec 20, 2024",
      due: "Jan 5, 2025",
      status: "submitted",
    },
    {
      title: "Algorithm Analysis Report",
      course: "CS 101",
      created: "Dec 15, 2024",
      due: "Dec 31, 2024",
      status: "grading",
    },
    {
      title: "Code Review Assignment",
      course: "CS 301",
      created: "Dec 10, 2024",
      due: "Dec 25, 2024",
      status: "graded",
      grade: "A",
    },
  ];

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

  return (
    <Layout>
      <div className="">
        <div className="mb-8">
          <h1 className="page-header">Assignments</h1>
          <p className="page-header-subtitle">Track and manage your coursework</p>
        </div>

        <div className="exposed-card glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-foreground/70">Assignment</TableHead>
                  <TableHead className="text-foreground/70">Course</TableHead>
                  <TableHead className="text-foreground/70">Created</TableHead>
                  <TableHead className="text-foreground/70">Due Date</TableHead>
                  <TableHead className="text-foreground/70">Status</TableHead>
                  <TableHead className="text-foreground/70 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment, index) => (
                  <TableRow
                    key={index}
                    className="border-border hover:bg-white/5 "
                  >
                    <TableCell className="font-medium text-foreground/90">
                      {assignment.title}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm px-2 py-1  bg-white/10">
                        {assignment.course}
                      </span>
                    </TableCell>
                    <TableCell className="text-foreground/60 text-sm">
                      {assignment.created}
                    </TableCell>
                    <TableCell className="text-foreground/80 text-sm">
                      {assignment.due}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`${getStatusColor(assignment.status)} capitalize`}
                      >
                        {assignment.status}
                        {assignment.grade && ` • ${assignment.grade}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" className="glass-button  h-8">
                          <Eye className="w-3 h-3 mr-1" />
                          View
                        </Button>
                        {assignment.status === "pending" && (
                          <Button size="sm" className="glass-button  h-8">
                            <Upload className="w-3 h-3 mr-1" />
                            Submit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          {[
            { label: "Pending", count: 3, color: "hsl(34 53% 81%)" },
            { label: "Submitted", count: 1, color: "hsl(210 50% 79%)" },
            { label: "Grading", count: 1, color: "hsl(20 60% 83%)" },
            { label: "Graded", count: 1, color: "hsl(247 63% 85%)" },
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
      </div>
    </Layout>
  );
};

export default Assignments;
