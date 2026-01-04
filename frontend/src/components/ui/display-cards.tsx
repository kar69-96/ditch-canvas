"use client";

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface DisplayCardProps {
  className?: string;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  date?: string;
  iconClassName?: string;
  titleClassName?: string;
}

function DisplayCard({
  className,
  icon = <Sparkles className="size-4 text-foreground" />,
  title = "Featured",
  description = "Discover amazing content",
  date = "Just now",
  iconClassName = "text-foreground",
  titleClassName = "text-foreground",
}: DisplayCardProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-[10rem] w-[22rem] -skew-y-[8deg] select-none flex-col justify-between rounded-xl border-2 border-border bg-background/50 backdrop-blur-sm px-4 py-4 transition-all duration-700 hover:border-foreground/20 hover:bg-background/70 z-10 hover:z-50 [&>*]:flex [&>*]:items-center [&>*]:gap-2",
        className
      )}
    >
      <div>
        <span className="relative inline-block rounded-full bg-foreground/10 p-1.5">
          {icon}
        </span>
        <p className={cn("text-lg font-semibold mt-2", titleClassName)}>{title}</p>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      <p className="text-xs text-muted-foreground font-medium">{date}</p>
    </div>
  );
}

interface DisplayCardsProps {
  cards?: DisplayCardProps[];
}

export default function DisplayCards({ cards }: DisplayCardsProps) {
  const defaultCards = [
    {
      className: "[grid-area:stack] hover:-translate-y-10 hover:scale-105 hover:translate-x-0 grayscale-[100%] hover:grayscale-0",
    },
    {
      className: "[grid-area:stack] translate-x-28 translate-y-10 hover:-translate-y-1 hover:scale-105 hover:translate-x-0 hover:z-50 grayscale-[100%] hover:grayscale-0",
    },
    {
      className: "[grid-area:stack] translate-x-56 translate-y-20 hover:translate-y-10 hover:scale-105 hover:translate-x-0 hover:z-50",
    },
  ];

  const displayCards = cards || defaultCards;

  return (
    <div className="grid [grid-template-areas:'stack'] place-items-center opacity-100 animate-in fade-in-0 duration-700">
      {displayCards.map((cardProps, index) => (
        <DisplayCard key={index} {...cardProps} />
      ))}
    </div>
  );
}

