export type ThemeOption = "paper" | "sand" | "moss" | "carbon";
export type FontOption = "sans" | "mono" | "serif" | "geometric";

// Theme display names for UI
export const themeDisplayNames: Record<ThemeOption, string> = {
  paper: "Paper",
  sand: "Sand",
  moss: "Moss",
  carbon: "Carbon",
};

// Theme descriptions for UI
export const themeDescriptions: Record<ThemeOption, string> = {
  paper: "Clean light theme with warm cream tones",
  sand: "Desert warmth with terracotta accents",
  moss: "Natural theme with forest green tones",
  carbon: "Sleek dark grayscale theme",
};

export interface UserPreferences {
  theme: ThemeOption;
  font: FontOption;
  onboarded: boolean;
}

const STORAGE_KEY = "user-preferences";
const BACKGROUND_STORAGE_KEY = "customBackgroundColor_v2";
export const DEFAULT_BACKGROUND_COLOR = "40 86% 97%";

export const defaultPreferences: UserPreferences = {
  theme: "paper",
  font: "sans",
  onboarded: false,
};

// Valid theme options for validation
const validThemes: ThemeOption[] = ["paper", "sand", "moss", "carbon"];

export function getPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate old theme values to new ones
      if (!validThemes.includes(parsed.theme)) {
        // Map old themes to new defaults
        if (parsed.theme === "light" || parsed.theme === "ink") {
          parsed.theme = "paper";
        } else if (parsed.theme === "dark") {
          parsed.theme = "carbon";
        } else {
          parsed.theme = "paper";
        }
        // Save the migrated preferences
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      }
      return parsed;
    }
  } catch (e) {
    console.error("Failed to load preferences", e);
  }
  return defaultPreferences;
}

export function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error("Failed to save preferences", e);
  }
}

export function applyTheme(theme: ThemeOption): void {
  const root = document.documentElement;

  // Remove all theme classes
  root.classList.remove(
    "theme-paper",
    "theme-sand",
    "theme-moss",
    "theme-carbon",
  );

  // Apply the selected theme class
  root.classList.add(`theme-${theme}`);

  // Clear any custom background color when switching themes
  // so the theme's default background is used
  localStorage.removeItem(BACKGROUND_STORAGE_KEY);

  // Also clear inline style so CSS theme variables take effect
  root.style.removeProperty("--background");
}

export function applyFont(font: FontOption): void {
  const root = document.documentElement;
  root.classList.remove(
    "font-style-mono",
    "font-style-serif",
    "font-style-geometric",
  );

  if (font !== "sans") {
    root.classList.add(`font-style-${font}`);
  }
}

/**
 * Convert hex color to HSL format
 * @param hex - Hex color string (e.g., "#F5F0E8" or "F5F0E8")
 * @returns HSL color string in format "h s% l%" (e.g., "40 25% 94%")
 */
export function hexToHsl(hex: string): string {
  // Remove # if present
  hex = hex.replace("#", "");

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  return `${h} ${s}% ${l}%`;
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  return trimmed.startsWith("#") ? hexToHsl(trimmed) : trimmed;
}

function applyBackgroundValue(color: string): void {
  const root = document.documentElement;
  root.style.setProperty("--background", color);
}

/**
 * Set custom background color
 * @param color - HSL color string in format "h s% l%" (e.g., "40 25% 94%") or hex color (e.g., "#F5F0E8")
 */
export function setBackgroundColor(color: string): void {
  const hslColor = normalizeColor(color);
  applyBackgroundValue(hslColor);
  localStorage.setItem(BACKGROUND_STORAGE_KEY, hslColor);
}

/**
 * Get custom background color
 */
export function getBackgroundColor(): string | null {
  return localStorage.getItem(BACKGROUND_STORAGE_KEY);
}

/**
 * Apply saved background color if one exists
 * If no custom color is saved, let the theme CSS handle it
 */
export function applyBackgroundColor(): void {
  const saved = getBackgroundColor();
  if (saved) {
    applyBackgroundValue(normalizeColor(saved));
  }
  // If no saved color, don't set inline style - let theme CSS handle it
}
