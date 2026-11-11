import React from 'react';
import { Braces } from 'lucide-react';
import { EnvVarTrigger } from '../utils/envVars';

export interface HoveredVarInfo {
  name: string;
  value: string;
  resolved: boolean;
  left: number;
  top: number;
}

interface DropdownProps {
  suggestions: [string, string][];
  highlightedIdx: number;
  onHighlight: (idx: number) => void;
  onSelect: (varName: string) => void;
  envName?: string;
  triggerMode?: EnvVarTrigger['mode'];
  isDark: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export const EnvVarDropdown: React.FC<DropdownProps> = ({
  suggestions,
  highlightedIdx,
  onHighlight,
  onSelect,
  envName,
  triggerMode = 'template',
  isDark,
  style,
  className = '',
}) => {
  if (suggestions.length === 0) return null;

  return (
    <div
      style={style}
      className={`z-50 rounded-xl border p-1.5 shadow-2xl ${
        isDark
          ? 'border-neutral-800 bg-[#161924] text-slate-100 shadow-black/80'
          : 'border-slate-300 bg-white text-slate-900 shadow-slate-300'
      } ${className}`}
    >
      <div
        className={`flex items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border-b mb-1 ${
          isDark ? 'border-neutral-800 text-slate-400' : 'border-slate-200 text-slate-500'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <Braces className="h-3 w-3 text-emerald-400" />
          <span>{envName || 'Environment'} Variables</span>
        </span>
        <span className="font-mono normal-case text-[10px] opacity-80">Tab / Click to insert</span>
      </div>

      <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
        {suggestions.map(([key, val], i) => {
          const isActiveRow = i === highlightedIdx;
          return (
            <button
              key={key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(key);
              }}
              onMouseEnter={() => onHighlight(i)}
              className={`w-full flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                isActiveRow
                  ? isDark
                    ? 'bg-violet-600/25 text-white'
                    : 'bg-violet-100 text-violet-900'
                  : isDark
                    ? 'hover:bg-neutral-800/70 text-slate-300'
                    : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              <span
                className={`font-mono font-bold shrink-0 ${
                  isDark ? 'text-emerald-400' : 'text-emerald-700'
                }`}
              >
                {triggerMode === 'script-key' ? `"${key}"` : `{{${key}}}`}
              </span>
              <span className="font-mono text-[11px] text-slate-400 truncate">
                {val || <em className="opacity-60">(empty)</em>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface TooltipProps {
  hoveredVar: HoveredVarInfo;
  envName?: string;
  isDark: boolean;
  positionMode?: 'fixed' | 'absolute';
}

export const EnvVarTooltip: React.FC<TooltipProps> = ({
  hoveredVar,
  envName,
  isDark,
  positionMode = 'fixed',
}) => {
  return (
    <div
      style={{ left: hoveredVar.left, top: hoveredVar.top }}
      className={`pointer-events-none ${positionMode} z-50 max-w-md rounded-xl border px-3 py-2 text-xs shadow-2xl ${
        isDark
          ? 'border-neutral-700 bg-[#11131a]/98 text-slate-100'
          : 'border-slate-300 bg-white/98 text-slate-900'
      }`}
    >
      <div className="flex items-center gap-2 font-mono font-bold">
        <span className={hoveredVar.resolved ? 'text-emerald-400' : 'text-amber-400'}>
          {`{{${hoveredVar.name}}}`}
        </span>
        <span className="text-[10px] font-sans font-semibold text-slate-400">
          {envName || 'No Env'}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[11px] break-all">
        {hoveredVar.resolved ? (
          hoveredVar.value || <em className="text-slate-400">(empty string)</em>
        ) : (
          <span className="text-amber-400 italic">Not set in active environment</span>
        )}
      </div>
    </div>
  );
};
