import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check } from "lucide-react";
import {
  ThemeOption,
  themeDisplayNames,
  themeDescriptions,
  applyTheme,
  getPreferences,
  savePreferences,
} from "@/lib/preferences";

const themes: ThemeOption[] = ["paper", "sand", "moss", "carbon"];

// Preview colors for each theme
const themePreviewColors: Record<
  ThemeOption,
  { bg: string; accent: string; text: string }
> = {
  paper: { bg: "#f7f3ed", accent: "#2d2518", text: "#2d2518" },
  sand: { bg: "#f5ebe0", accent: "#c67b5c", text: "#5c4a32" },
  moss: { bg: "#f5f2eb", accent: "#6b8e6b", text: "#2d3a2d" },
  carbon: { bg: "#121212", accent: "#e0e0e0", text: "#e0e0e0" },
};

export default function OnboardingTheme() {
  const navigate = useNavigate();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>("paper");

  useEffect(() => {
    // Check if onboarding data exists
    const data = sessionStorage.getItem("onboarding_data");
    if (!data) {
      navigate("/onboarding/info");
      return;
    }
  }, [navigate]);

  const handleThemeSelect = (theme: ThemeOption) => {
    setSelectedTheme(theme);
    applyTheme(theme);
  };

  const handleContinue = () => {
    // Save the theme preference
    const prefs = getPreferences();
    prefs.theme = selectedTheme;
    savePreferences(prefs);

    // Continue to invite step
    navigate("/onboarding/invite");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Choose Your Theme</CardTitle>
          <CardDescription>
            Select a visual style that suits you. You can change this later in
            settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 mb-6">
            {themes.map((theme) => {
              const colors = themePreviewColors[theme];
              const isSelected = selectedTheme === theme;

              return (
                <button
                  key={theme}
                  onClick={() => handleThemeSelect(theme)}
                  className={`relative p-4 border-2 transition-all ${
                    isSelected
                      ? "border-foreground"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  style={{
                    borderRadius:
                      theme === "paper"
                        ? "0"
                        : theme === "moss"
                          ? "16px"
                          : "12px",
                  }}
                >
                  {/* Theme Preview */}
                  <div
                    className="aspect-video mb-3 flex flex-col items-center justify-center overflow-hidden"
                    style={{
                      backgroundColor: colors.bg,
                      borderRadius:
                        theme === "paper"
                          ? "0"
                          : theme === "moss"
                            ? "12px"
                            : "8px",
                    }}
                  >
                    {/* Mini preview card */}
                    <div
                      className="w-3/4 p-2"
                      style={{
                        backgroundColor:
                          theme === "carbon" ? "#1e1e1e" : "#fff",
                        borderRadius:
                          theme === "paper"
                            ? "0"
                            : theme === "moss"
                              ? "8px"
                              : "6px",
                        border: `1px solid ${theme === "carbon" ? "#333" : "#e5e5e5"}`,
                      }}
                    >
                      <div
                        className="h-2 w-2/3 mb-1"
                        style={{
                          backgroundColor: colors.text,
                          opacity: 0.8,
                          borderRadius: "2px",
                        }}
                      />
                      <div
                        className="h-1.5 w-full mb-1"
                        style={{
                          backgroundColor: colors.text,
                          opacity: 0.3,
                          borderRadius: "2px",
                        }}
                      />
                      <div
                        className="h-1.5 w-4/5"
                        style={{
                          backgroundColor: colors.text,
                          opacity: 0.3,
                          borderRadius: "2px",
                        }}
                      />
                    </div>
                    {/* Accent element */}
                    <div
                      className="mt-2 px-3 py-1 text-xs"
                      style={{
                        backgroundColor: colors.accent,
                        color: theme === "carbon" ? "#121212" : "#fff",
                        borderRadius: theme === "paper" ? "0" : "4px",
                      }}
                    >
                      Button
                    </div>
                  </div>

                  {/* Theme Info */}
                  <div className="text-left">
                    <h3 className="font-medium text-foreground">
                      {themeDisplayNames[theme]}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {themeDescriptions[theme]}
                    </p>
                  </div>

                  {/* Selected indicator */}
                  {isSelected && (
                    <div
                      className="absolute top-2 right-2 w-6 h-6 bg-foreground text-background flex items-center justify-center"
                      style={{ borderRadius: theme === "paper" ? "0" : "50%" }}
                    >
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <Button onClick={handleContinue} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
