import { useEffect } from 'react';
import { sessionStorage } from '@/storage/session';
import { userDatabase } from '@/services/database/userDatabase';
import { applyBackgroundColor } from '@/lib/preferences';

// Default theme values (previously from backgrounds)
const DEFAULT_THEME = {
  type: 'dark' as const,
  primaryColor: '270 90% 80%',
  textColor: '0 0% 99%',
  glassOpacity: 0.08,
  glassBorderOpacity: 0.25,
  overlayOpacity: 0.6,
  accentColor: '320 85% 75%',
};

/**
 * Hook to apply user preferences (background, font, style) to the app
 * Fetches preferences from Supabase via backend API
 */
export function useUserPreferences() {
  useEffect(() => {
    async function loadPreferences() {
      // Apply custom background color first if set
      applyBackgroundColor();

      // Apply default color mode first (dark)
      const root = document.documentElement;
      if (!root.hasAttribute('data-color-mode')) {
        root.setAttribute('data-color-mode', 'dark');
      }

      const session = await sessionStorage.getSession();
      if (!session?.email) {
        // Try localStorage fallback for color mode
        const colorMode = localStorage.getItem('colorMode') as 'light' | 'dark' | 'system' | null;
        if (colorMode && ['light', 'dark', 'system'].includes(colorMode)) {
          applyColorMode(colorMode);
        }
        return;
      }

      // Get user from Supabase via backend API
      const user = await userDatabase.getUserByEmail(session.email);
      const profilePrefs = user?.profilePreferences as any;

      if (!profilePrefs) {
        // Try localStorage as fallback
        const bg = localStorage.getItem('preferredBackground');
        const font = localStorage.getItem('preferredFont');
        const style = localStorage.getItem('stylePreferences');

        const colorMode = localStorage.getItem('colorMode') as 'light' | 'dark' | 'system' | null;
        if (colorMode && ['light', 'dark', 'system'].includes(colorMode)) {
          applyColorMode(colorMode);
        }
        if (bg) applyBackground(bg);
        if (font) applyFont(font);
        if (style) {
          try {
            applyStyle(JSON.parse(style));
          } catch (e) {
            console.error('Error parsing style preferences:', e);
          }
        }
        return;
      }

      const { background, font, style, colorMode } = profilePrefs;

      // Apply color mode
      if (colorMode) {
        applyColorMode(colorMode);
      } else {
        // Check localStorage fallback
        const savedMode = localStorage.getItem('colorMode') as 'light' | 'dark' | 'system' | null;
        if (savedMode && ['light', 'dark', 'system'].includes(savedMode)) {
          applyColorMode(savedMode);
        }
      }

      // Apply background
      if (background) {
        applyBackground(background);
      }

      // Apply font
      if (font) {
        applyFont(font);
      }

      // Apply style preferences
      if (style) {
        try {
          const stylePrefs = JSON.parse(style);
          applyStyle(stylePrefs);
        } catch (e) {
          console.error('Error parsing style preferences:', e);
        }
      }
    }

    loadPreferences();
  }, []);
}

function applyBackground(backgroundId: string) {
  // Use default theme values (background images are not used)
  const theme = DEFAULT_THEME;

  // Apply to body::before pseudo-element via style tag
  let styleTag = document.getElementById('user-bg-style');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'user-bg-style';
    document.head.appendChild(styleTag);
  }

  const root = document.documentElement;

  // Apply theme CSS variables
  root.style.setProperty('--theme-primary', theme.primaryColor);
  root.style.setProperty('--theme-text', theme.textColor);
  root.style.setProperty('--theme-glass-opacity', theme.glassOpacity.toString());
  root.style.setProperty('--theme-glass-border-opacity', theme.glassBorderOpacity.toString());
  root.style.setProperty('--theme-overlay-opacity', theme.overlayOpacity.toString());
  if (theme.accentColor) {
    root.style.setProperty('--theme-accent', theme.accentColor);
  }

  // Create enhanced gradient colors for better visibility on dark cards
  // Parse HSL and enhance lightness for better contrast
  const enhanceGradientColor = (hslColor: string, isDark: boolean): string => {
    const match = hslColor.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
    if (!match) return hslColor;

    const [, h, s, l] = match;
    const lightness = parseFloat(l);

    // For dark backgrounds: increase lightness to 85-90% for maximum visibility
    // For light backgrounds: keep darker but ensure minimum 50% for visibility
    const enhancedLightness = isDark
      ? Math.min(90, Math.max(85, lightness + 10)) // Brighten for dark backgrounds
      : Math.max(50, Math.min(60, lightness)); // Ensure visibility on light backgrounds

    return `${h} ${s}% ${enhancedLightness}%`;
  };

  // Set enhanced gradient colors
  const gradientPrimary = enhanceGradientColor(theme.primaryColor, theme.type === 'dark');
  const gradientAccent = theme.accentColor
    ? enhanceGradientColor(theme.accentColor, theme.type === 'dark')
    : enhanceGradientColor(theme.primaryColor, theme.type === 'dark');

  root.style.setProperty('--gradient-primary-color', gradientPrimary);
  root.style.setProperty('--gradient-accent-color', gradientAccent);

  // Set data attribute for theme type to enable CSS targeting
  root.setAttribute('data-theme-type', theme.type);

  // Don't apply background images - use beige background instead
  // Clear any existing background styles
  styleTag.textContent = `
    body::before {
      background: transparent !important;
      background-image: none !important;
    }
    body::after {
      background: transparent !important;
      opacity: 0 !important;
    }
  `;
}

function applyFont(fontId: string) {
  const fontMap: Record<string, string> = {
    'outfit': 'Outfit, sans-serif',
    'inter': 'Inter, sans-serif',
    'poppins': 'Poppins, sans-serif',
    'playfair': 'Playfair Display, serif',
    'space-grotesk': 'Space Grotesk, sans-serif',
  };

  const fontFamily = fontMap[fontId] || fontMap['outfit'];
  document.body.style.fontFamily = fontFamily;
}

function applyStyle(stylePrefs: { glassEffect?: boolean; animations?: boolean; compactMode?: boolean }) {
  const root = document.documentElement;

  if (stylePrefs.glassEffect !== undefined) {
    if (stylePrefs.glassEffect) {
      // Restore glass effect - use default theme
      root.style.setProperty('--theme-glass-opacity', DEFAULT_THEME.glassOpacity.toString());
      root.classList.remove('no-glass-effect');
    } else {
      // Disable glass effect - make it almost transparent
      root.style.setProperty('--theme-glass-opacity', '0.01');
      root.classList.add('no-glass-effect');
    }
  }

  if (stylePrefs.animations !== undefined) {
    if (!stylePrefs.animations) {
      root.classList.add('no-animations');
      root.style.setProperty('--animation-duration', '0ms');
    } else {
      root.classList.remove('no-animations');
      root.style.removeProperty('--animation-duration');
    }
  }

  if (stylePrefs.compactMode !== undefined) {
    root.classList.toggle('compact-mode', stylePrefs.compactMode);
  }
}

function applyColorMode(mode: 'light' | 'dark' | 'system') {
  const root = document.documentElement;

  if (mode === 'system') {
    // Use OS preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-color-mode', prefersDark ? 'dark' : 'light');

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const newPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-color-mode', newPrefersDark ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    // Note: We don't clean up this listener, but that's okay for a global preference
  } else {
    root.setAttribute('data-color-mode', mode);
  }
}
