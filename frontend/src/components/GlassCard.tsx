import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

const GlassCard = ({ children, className, hover = true, onClick }: GlassCardProps) => {
  return (
    <div
      className={cn(
        "exposed-card glass-card p-6",
        hover ? "cursor-pointer" : "cursor-default glass-card-static",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

export default GlassCard;
