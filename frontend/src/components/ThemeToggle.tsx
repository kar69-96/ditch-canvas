import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState, useEffect } from "react";
import { sessionStorage } from "@/storage/session";
import { userDatabase } from "@/services/database/userDatabase";

type ColorMode = 'light' | 'dark' | 'system';

export function ThemeToggle() {
  const [colorMode, setColorMode] = useState<ColorMode>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    async function loadColorMode() {
      setMounted(true);
      // Load color mode preference
      const session = await sessionStorage.getSession();
      if (session?.email) {
        const user = await userDatabase.getUserByEmail(session.email);
        const savedMode = (user?.profilePreferences as any)?.colorMode || localStorage.getItem('colorMode') as ColorMode;
        if (savedMode && ['light', 'dark', 'system'].includes(savedMode)) {
          setColorMode(savedMode);
          applyColorMode(savedMode);
        }
      } else {
        const savedMode = localStorage.getItem('colorMode') as ColorMode;
        if (savedMode && ['light', 'dark', 'system'].includes(savedMode)) {
          setColorMode(savedMode);
          applyColorMode(savedMode);
        }
      }
    }

    loadColorMode();
  }, []);

  const applyColorMode = (mode: ColorMode) => {
    const root = document.documentElement;

    if (mode === 'system') {
      // Use OS preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-color-mode', prefersDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-color-mode', mode);
    }
  };

  const handleColorModeChange = async (mode: ColorMode) => {
    setColorMode(mode);
    applyColorMode(mode);

    // Save to user profile in Supabase
    const session = await sessionStorage.getSession();
    if (session?.email) {
      const user = await userDatabase.getUserByEmail(session.email);
      if (user) {
        const updatedPreferences = {
          ...(user.profilePreferences || {}),
          colorMode: mode
        };
        await userDatabase.updateUser(user.id, { profilePreferences: updatedPreferences });
      }
    }

    // Also save to localStorage for immediate fallback
    localStorage.setItem('colorMode', mode);
  };

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (colorMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      applyColorMode('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [colorMode]);

  if (!mounted) {
    return null; // Prevent hydration mismatch
  }

  const getIcon = () => {
    switch (colorMode) {
      case 'light':
        return <Sun className="w-5 h-5" />;
      case 'dark':
        return <Moon className="w-5 h-5" />;
      case 'system':
        return <Monitor className="w-5 h-5" />;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-foreground hover:text-foreground hover:bg-white/10  px-3 py-2 h-auto w-auto min-w-[40px]"
          title="Toggle theme"
        >
          {getIcon()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="glass-card w-48 p-2" align="end">
        <div className="space-y-1">
          <button
            onClick={() => handleColorModeChange('light')}
            className={`w-full flex items-center gap-3 px-3 py-2   ${
              colorMode === 'light'
                ? 'bg-white/20 text-foreground'
                : 'hover:bg-white/10 text-foreground/80'
            }`}
          >
            <Sun className="w-4 h-4" />
            <span className="text-sm font-medium">Light</span>
          </button>
          <button
            onClick={() => handleColorModeChange('dark')}
            className={`w-full flex items-center gap-3 px-3 py-2   ${
              colorMode === 'dark'
                ? 'bg-white/20 text-foreground'
                : 'hover:bg-white/10 text-foreground/80'
            }`}
          >
            <Moon className="w-4 h-4" />
            <span className="text-sm font-medium">Dark</span>
          </button>
          <button
            onClick={() => handleColorModeChange('system')}
            className={`w-full flex items-center gap-3 px-3 py-2   ${
              colorMode === 'system'
                ? 'bg-white/20 text-foreground'
                : 'hover:bg-white/10 text-foreground/80'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span className="text-sm font-medium">System</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
