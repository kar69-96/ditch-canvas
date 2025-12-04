import { useState } from "react";
import { ThemeSelector } from "./ThemeSelector";
import { FontSelector } from "./FontSelector";
import { ThemeOption, FontOption, applyTheme, applyFont, savePreferences } from "@/lib/preferences";
import { ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState<ThemeOption>("light");
  const [font, setFont] = useState<FontOption>("sans");

  const handleThemeChange = (newTheme: ThemeOption) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  const handleFontChange = (newFont: FontOption) => {
    setFont(newFont);
    applyFont(newFont);
  };

  const handleComplete = () => {
    savePreferences({ theme, font, onboarded: true });
    onComplete();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top line */}
      <div className="h-px bg-border" />
      
      {/* Header */}
      <header className="px-6 py-4 border-b border-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Setup
          </span>
          <span className="text-xs text-muted-foreground">
            {step + 1} / 2
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg ">
          {step === 0 && (
            <ThemeSelector selected={theme} onSelect={handleThemeChange} />
          )}
          {step === 1 && (
            <FontSelector selected={font} onSelect={handleFontChange} />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          {step > 0 ? (
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground "
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {step < 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </footer>

      {/* Progress bar */}
      <div className="h-1 bg-border">
        <div
          className="h-full bg-foreground "
          style={{ width: `${((step + 1) / 2) * 100}%` }}
        />
      </div>
    </div>
  );
}
