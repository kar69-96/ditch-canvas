interface SemesterProgressProps {
  percentage: number;
  message: string;
  isOnBreak?: boolean;
}

export function SemesterProgress({ percentage, message, isOnBreak = false }: SemesterProgressProps) {
  if (isOnBreak) {
    return (
      <div className="exposed-card glass-card  ">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Semester Progress
          </h2>
        </div>
        
        <div className="p-5">
          <div className="flex items-center justify-center py-8">
            <span className="text-xl font-medium text-foreground">Enjoy your break!</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="exposed-card glass-card  ">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Semester Progress
        </h2>
      </div>
      
      <div className="p-5">
        <div className="flex items-end justify-between mb-3">
          <span className="text-4xl font-medium text-foreground">{percentage}%</span>
        </div>
        
        {/* Progress bar */}
        <div className="h-1 bg-progress-bg">
          <div
            className="h-full bg-progress-fill transition-all duration-700"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
