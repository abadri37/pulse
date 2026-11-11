import React from 'react';
import { Home, Rocket, Plus, Settings, Activity, Compass, Zap } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface Props {
  activeView: 'client' | 'loadtest';
  onSelectView: (view: 'client' | 'loadtest') => void;
  onOpenPreferences: () => void;
  onOpenCreateCollection: () => void;
  collectionNames: string[];
}

export const IconRail: React.FC<Props> = ({
  activeView,
  onSelectView,
  onOpenPreferences,
  onOpenCreateCollection,
  collectionNames,
}) => {
  const { isDark, accentDef } = useTheme();

  return (
    <div className={`w-13 flex flex-col items-center justify-between py-3 border-r select-none transition-colors duration-200 shrink-0 ${
      isDark ? 'bg-[#0a0c13] border-neutral-800/80' : 'bg-slate-900 border-slate-800 text-white'
    }`}>
      {/* Top Stack */}
      <div className="flex flex-col items-center gap-3 w-full">
        {/* Brand Ring Logo */}
        <div
          className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-md shadow-violet-500/30 cursor-pointer hover:scale-105 transition"
          title="Pulse - Local-First API Client"
        >
          <Activity className="h-5 w-5" />
        </div>

        <div className="h-[1px] w-6 bg-white/10 my-1" />

        {/* Home / Explorer Icon */}
        <button
          onClick={() => onSelectView('client')}
          className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition ${
            activeView === 'client'
              ? 'bg-violet-600 text-white shadow-sm shadow-violet-500/40 ring-2 ring-violet-400/30'
              : 'text-slate-400 hover:text-white hover:bg-white/10'
          }`}
          title="API Client & Debugger"
        >
          <Compass className="h-4.5 w-4.5" />
        </button>

        {/* Load Test Rocket Icon */}
        <button
          onClick={() => onSelectView('loadtest')}
          className={`relative flex h-8 w-8 items-center justify-center rounded-xl transition ${
            activeView === 'loadtest'
              ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/40 ring-2 ring-amber-400/30'
              : 'text-slate-400 hover:text-amber-400 hover:bg-white/10'
          }`}
          title="Integrated Load Tester"
        >
          <Rocket className="h-4.5 w-4.5" />
        </button>

        {/* Workspace Letter Badges (like "IT", "GD", "IA" in Image 1) */}
        {collectionNames.slice(0, 3).map((name, i) => {
          const initials = name
            .split(' ')
            .map((w) => w[0])
            .join('')
            .substring(0, 2)
            .toUpperCase() || 'AP';

          return (
            <button
              key={i}
              onClick={() => onSelectView('client')}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-[10px] font-black tracking-wider text-slate-300 hover:bg-violet-600/30 hover:text-white hover:border-violet-500 transition shadow-2xs"
              title={`Workspace: ${name}`}
            >
              {initials}
            </button>
          );
        })}

        {/* Plus Button */}
        <button
          onClick={onOpenCreateCollection}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
          title="New Collection / Workspace"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom Stack: Settings Cog */}
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onOpenPreferences}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
          title="Preferences & Theme Settings"
        >
          <Settings className="h-4.5 w-4.5" />
        </button>
      </div>
    </div>
  );
};
