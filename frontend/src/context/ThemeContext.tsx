import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'dark' | 'light';
export type AccentColor = 'violet' | 'indigo' | 'emerald' | 'cyan' | 'rose' | 'amber';

export interface AccentDefinition {
  id: AccentColor;
  name: string;
  hex: string;
  bgGradient: string;
  buttonClass: string;
  activeBorder: string;
  badgeBg: string;
  textClass: string;
  ringClass: string;
  glowClass: string;
}

// Vibrant color accents
export const ACCENTS: Record<AccentColor, AccentDefinition> = {
  violet: {
    id: 'violet',
    name: 'Electric Violet',
    hex: '#8b5cf6',
    bgGradient: 'from-violet-600 to-indigo-600',
    buttonClass: 'bg-violet-600 hover:bg-violet-500 text-white',
    activeBorder: 'border-violet-500',
    badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    textClass: 'text-violet-400',
    ringClass: 'ring-violet-500',
    glowClass: 'shadow-violet-500/25',
  },
  indigo: {
    id: 'indigo',
    name: 'Pulse Indigo',
    hex: '#6366f1',
    bgGradient: 'from-indigo-600 to-indigo-700',
    buttonClass: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    activeBorder: 'border-indigo-500',
    badgeBg: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    textClass: 'text-indigo-400',
    ringClass: 'ring-indigo-500',
    glowClass: 'shadow-indigo-500/25',
  },
  emerald: {
    id: 'emerald',
    name: 'Cyber Emerald',
    hex: '#10b981',
    bgGradient: 'from-emerald-600 to-emerald-700',
    buttonClass: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    activeBorder: 'border-emerald-500',
    badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    textClass: 'text-emerald-400',
    ringClass: 'ring-emerald-500',
    glowClass: 'shadow-emerald-500/25',
  },
  cyan: {
    id: 'cyan',
    name: 'Ocean Cyan',
    hex: '#06b6d4',
    bgGradient: 'from-cyan-600 to-cyan-700',
    buttonClass: 'bg-cyan-600 hover:bg-cyan-500 text-white',
    activeBorder: 'border-cyan-500',
    badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    textClass: 'text-cyan-400',
    ringClass: 'ring-cyan-500',
    glowClass: 'shadow-cyan-500/25',
  },
  rose: {
    id: 'rose',
    name: 'Crimson Rose',
    hex: '#f43f5e',
    bgGradient: 'from-rose-600 to-rose-700',
    buttonClass: 'bg-rose-600 hover:bg-rose-500 text-white',
    activeBorder: 'border-rose-500',
    badgeBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    textClass: 'text-rose-400',
    ringClass: 'ring-rose-500',
    glowClass: 'shadow-rose-500/25',
  },
  amber: {
    id: 'amber',
    name: 'Sunset Amber',
    hex: '#f59e0b',
    bgGradient: 'from-amber-600 to-amber-700',
    buttonClass: 'bg-amber-600 hover:bg-amber-500 text-white',
    activeBorder: 'border-amber-500',
    badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    textClass: 'text-amber-400',
    ringClass: 'ring-amber-500',
    glowClass: 'shadow-amber-500/25',
  },
};

interface ThemeContextType {
  mode: ThemeMode;
  accent: AccentColor;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentColor) => void;
  toggleMode: () => void;
  accentDef: AccentDefinition;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('pulse_theme_mode');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // fallback
    }
    return 'dark';
  });

  const [accent, setAccentState] = useState<AccentColor>(() => {
    try {
      const saved = localStorage.getItem('pulse_theme_accent');
      if (saved && saved in ACCENTS) return saved as AccentColor;
    } catch {
      // fallback
    }
    return 'violet'; // Default to signature violet
  });

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem('pulse_theme_mode', newMode);
    } catch {
      // ignore
    }
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('pulse_theme_mode', next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setAccent = useCallback((newAccent: AccentColor) => {
    setAccentState(newAccent);
    try {
      localStorage.setItem('pulse_theme_accent', newAccent);
    } catch {
      // ignore
    }
  }, []);

  // Synchronize with DOM attributes
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-accent', accent);
    if (mode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    if (document.body) {
      document.body.setAttribute('data-theme', mode);
      document.body.setAttribute('data-accent', accent);
    }
  }, [mode, accent]);

  const accentDef = ACCENTS[accent] || ACCENTS.violet;

  return (
    <ThemeContext.Provider
      value={{
        mode,
        accent,
        setMode,
        setAccent,
        toggleMode,
        accentDef,
        isDark: mode === 'dark',
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
