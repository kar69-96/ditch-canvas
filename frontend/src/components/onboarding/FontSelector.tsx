import { cn } from "@/lib/utils";
import { FontOption } from "@/lib/preferences";
import { Check } from "lucide-react";

interface FontSelectorProps {
  selected: FontOption;
  onSelect: (font: FontOption) => void;
}

const fonts: { id: FontOption; name: string; sample: string; className: string }[] = [
  {
    id: "sans",
    name: "Sans",
    sample: "Clean & Modern",
    className: "font-sans",
  },
  {
    id: "mono",
    name: "Mono",
    sample: "Technical & Precise",
    className: "font-mono",
  },
  {
    id: "serif",
    name: "Serif",
    sample: "Editorial & Classic",
    className: "font-serif",
  },
  {
    id: "geometric",
    name: "Geometric",
    sample: "Bold & Structured",
    className: "font-geometric",
  },
];

export function FontSelector({ selected, onSelect }: FontSelectorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-foreground">Choose your typeface</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a font that feels right
        </p>
      </div>

      <div className="space-y-3">
        {fonts.map((font) => (
          <button
            key={font.id}
            onClick={() => onSelect(font.id)}
            className={cn(
              "w-full p-4 border transition-all text-left flex items-center justify-between group",
              selected === font.id
                ? "border-foreground bg-secondary/30"
                : "border-border hover:border-muted-foreground"
            )}
          >
            <div>
              <p className={cn("text-lg font-medium", font.className)}>
                {font.name}
              </p>
              <p className={cn("text-sm text-muted-foreground", font.className)}>
                {font.sample}
              </p>
            </div>
            {selected === font.id && (
              <Check className="w-5 h-5 text-foreground" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
