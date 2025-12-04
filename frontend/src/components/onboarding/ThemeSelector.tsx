import { cn } from "@/lib/utils";
import { ThemeOption } from "@/lib/preferences";
import { Check } from "lucide-react";

interface ThemeSelectorProps {
  selected: ThemeOption;
  onSelect: (theme: ThemeOption) => void;
}

const themes: { id: ThemeOption; name: string; preview: { bg: string; fg: string; accent: string } }[] = [
  {
    id: "light",
    name: "Light",
    preview: { bg: "#fafafa", fg: "#0f0f0f", accent: "#e5e5e5" },
  },
  {
    id: "dark",
    name: "Dark",
    preview: { bg: "#0a0a0a", fg: "#ebebeb", accent: "#1f1f1f" },
  },
  {
    id: "paper",
    name: "Paper",
    preview: { bg: "#f7f4ef", fg: "#2a261f", accent: "#e8e2d6" },
  },
  {
    id: "ink",
    name: "Ink",
    preview: { bg: "#f7f8fa", fg: "#0d1526", accent: "#e8ebf0" },
  },
];

export function ThemeSelector({ selected, onSelect }: ThemeSelectorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-foreground">Choose your theme</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a visual style that suits you
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {themes.map((theme) => (
          <button
            key={theme.id}
            onClick={() => onSelect(theme.id)}
            className={cn(
              "relative group p-4 border transition-all text-left",
              selected === theme.id
                ? "border-foreground"
                : "border-border hover:border-muted-foreground"
            )}
          >
            {/* Preview */}
            <div
              className="aspect-[4/3] mb-3 border border-border/50 overflow-hidden"
              style={{ backgroundColor: theme.preview.bg }}
            >
              <div className="p-3 h-full flex flex-col">
                <div
                  className="h-2 w-12 mb-2"
                  style={{ backgroundColor: theme.preview.fg }}
                />
                <div
                  className="h-1.5 w-20 mb-4"
                  style={{ backgroundColor: theme.preview.accent }}
                />
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div
                    className="rounded-sm"
                    style={{ backgroundColor: theme.preview.accent }}
                  />
                  <div
                    className="rounded-sm"
                    style={{ backgroundColor: theme.preview.accent }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{theme.name}</span>
              {selected === theme.id && (
                <Check className="w-4 h-4 text-foreground" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
