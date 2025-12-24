import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

interface ClassItem {
  id: number;
  code: string;
  details: string;
}

interface ActiveClassesProps {
  classes: ClassItem[];
}

export function ActiveClasses({ classes }: ActiveClassesProps) {
  return (
    <div className="exposed-card glass-card  ">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Active Classes
        </h2>
      </div>
      
      <div>
        {classes.map((cls, index) => (
          <Link
            key={cls.code}
            to={`/courses/${cls.id}`}
            className="group fill-hover fill-hover-light flex items-center justify-between px-5 py-4 border-b border-border last:border-b-0 cursor-pointer block"
          >
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground w-6">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="text-sm font-medium text-foreground group-hover:text-inherit">
                  {cls.code}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5 group-hover:text-inherit opacity-90">
                  {cls.details}
                </p>
              </div>
            </div>
            <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity fill-hover-icon" />
          </Link>
        ))}
      </div>
    </div>
  );
}
