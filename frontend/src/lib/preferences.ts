export type ThemeOption = "light" | "dark" | "paper" | "ink";
export type FontOption = "sans" | "mono" | "serif" | "geometric";

export interface UserPreferences {
  theme: ThemeOption;
  font: FontOption;
  onboarded: boolean;
}

const STORAGE_KEY = "user-preferences";
const BACKGROUND_STORAGE_KEY = "customBackgroundColor_v2";
export const DEFAULT_BACKGROUND_COLOR = "40 86% 97%";

export const defaultPreferences: UserPreferences = {
  theme: "light",
  font: "sans",
  onboarded: false,
};

export function getPreferences(): UserPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
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
  
  root.classList.remove("theme-dark", "theme-paper", "theme-ink");
  
  if (theme !== "light") {
    root.classList.add(`theme-${theme}`);
  }
  
  // Always ensure the global background color is applied,
  // regardless of the selected theme or page.
  applyBackgroundColor();
}

export function applyFont(font: FontOption): void {
  const root = document.documentElement;
  root.classList.remove("font-style-mono", "font-style-serif", "font-style-geometric");
  
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
  hex = hex.replace('#', '');
  
  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
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
 * Apply saved background color or use default
 */
export function applyBackgroundColor(): void {
  const saved = getBackgroundColor();
  const colorToApply = saved ? normalizeColor(saved) : DEFAULT_BACKGROUND_COLOR;
  applyBackgroundValue(colorToApply);
}
