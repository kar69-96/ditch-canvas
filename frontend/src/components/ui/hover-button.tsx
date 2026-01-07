import * as React from "react";
import { cn } from "@/lib/utils";

export interface HoverSlatButtonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  initialText: string;
}

const HoverSlatButton = React.forwardRef<
  HTMLDivElement,
  HoverSlatButtonProps
>(({ initialText, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("fill-hover fill-hover-light cursor-pointer border border-foreground/20 inline-flex items-center justify-center h-10 px-8 text-sm font-bold text-foreground relative overflow-hidden", className)}
      {...props}
    >
      <span className="relative z-10">{initialText}</span>
    </div>
  );
});

HoverSlatButton.displayName = "HoverSlatButton";

export default HoverSlatButton;
