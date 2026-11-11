import React, { useState, useRef, useEffect } from 'react';
import { Environment } from '../types';
import { useTheme, ACCENTS, AccentColor } from '../context/ThemeContext';
import {
  Activity,
  Settings,
  Maximize2,
  Sun,
  Moon,
  Palette,
  Check,
  ChevronDown,
  Upload,
  Download,
  Pencil,
} from 'lucide-react';

interface Props {
  environments: Environment[];
  activeEnvId: string;
  onSelectEnv: (id: string) => void;
  onOpenEnvModal: () => void;
  requestName: string;
  onRequestNameChange: (name: string) => void;
  onRequestNameCommit?: () => void;
  onToggleFullscreen: () => void;
  onOpenImport: () => void;
  onExportRequest: () => void;
  onExportRequestOpenAPI: () => void;
  onExportCollectionJSON: () => void;
  onExportCollectionOpenAPI: () => void;
  isExportedRecently?: boolean;
  appVersion?: string;
}

export const Header: React.FC<Props> = ({
  environments,
  activeEnvId,
  onSelectEnv,
  onOpenEnvModal,
  requestName,
  onRequestNameChange,
  onRequestNameCommit,
  onToggleFullscreen,
  onOpenImport,
  onExportRequest,
  onExportRequestOpenAPI,
  onExportCollectionJSON,
  onExportCollectionOpenAPI,
  isExportedRecently = false,
  appVersion = '1.0.0',
}) => {
  const { mode, toggleMode, setMode, accent, setAccent, accentDef, isDark } = useTheme();
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeEnv = environments.find((e) => e.id === activeEnvId);

  return (
    <header className={`flex h-13 items-center justify-between border-b px-4 select-none transition-colors duration-200 ${
      isDark
        ? 'border-neutral-800/80 bg-[#11131a]/95 backdrop-blur-xl text-neutral-100'
        : 'border-slate-300 bg-white/95 backdrop-blur-xl text-slate-900 shadow-xs'
    }`}>
      {/* Left: Pulse Brand + Request Name Editor */}
      <div className="flex items-center gap-3.5">
        {/* Pulse Logo Badge with Gradient */}
        <div className="flex items-center gap-2.5 font-bold text-sm tracking-wide">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/30 transition-transform hover:scale-105">
            <Activity className="h-4.5 w-4.5" />
          </div>
          <span className="font-black text-base tracking-tight bg-gradient-to-r from-violet-400 via-indigo-300 to-cyan-400 bg-clip-text text-transparent">
            Pulse
          </span>
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-bold ${
              isDark
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                : 'border-violet-300 bg-violet-50 text-violet-700'
            }`}
            title={`Pulse Version v${appVersion}`}
          >
            v{appVersion}
          </span>
        </div>

        <div className={`h-4 w-[1px] ${isDark ? 'bg-neutral-800' : 'bg-slate-300'}`} />

        {/* Request Name Editor */}
        <div className="relative group flex items-center select-text">
          <input
            type="text"
            value={requestName}
            onChange={(e) => onRequestNameChange(e.target.value)}
            onBlur={() => onRequestNameCommit?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            placeholder="Untitled Request"
            title="Click to rename active request (press Enter to save)"
            className={`w-48 rounded-xl pl-3 pr-7 py-1 text-xs font-bold transition border select-text focus:outline-none ${
              isDark
                ? 'border-neutral-800/70 bg-neutral-900/50 text-neutral-100 hover:border-neutral-700 hover:bg-neutral-800/80 focus:border-violet-500 focus:bg-neutral-900'
                : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 hover:bg-slate-100 focus:border-violet-500 focus:bg-white'
            }`}
          />
          <Pencil className="h-3 w-3 text-neutral-500 pointer-events-none absolute right-2.5 opacity-60 group-hover:opacity-100" />
        </div>
      </div>

      {/* Right Actions: Import, Export, Environment, Direct 1-Click Theme Toggle, Palette, Fullscreen */}
      <div className="flex items-center gap-2">
        {/* Separate Import & Export Request Buttons */}
        <button
          onClick={onOpenImport}
          className={`flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition shadow-xs cursor-pointer ${
            isDark
              ? 'border-neutral-800 bg-[#161822] text-indigo-300 hover:bg-indigo-600/20 hover:text-white hover:border-indigo-500/50'
              : 'border-slate-300 bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-400'
          }`}
          title="Import Request or Collection (JSON, CSV, cURL)"
        >
          <Upload className="h-3.5 w-3.5 text-indigo-400" />
          <span>Import</span>
        </button>

        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
            className={`flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition shadow-xs cursor-pointer ${
              isExportedRecently
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                : isDark
                  ? 'border-neutral-800 bg-[#161822] text-emerald-300 hover:bg-emerald-600/20 hover:text-white hover:border-emerald-500/50'
                  : 'border-slate-300 bg-white text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400'
            }`}
            title="Export Collection or Request (OpenAPI v2 / JSON)"
          >
            {isExportedRecently ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Download className="h-3.5 w-3.5 text-emerald-400" />}
            <span>{isExportedRecently ? 'Exported' : 'Export'}</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>

          {isExportMenuOpen && (
            <div className={`absolute right-0 top-10 z-50 w-72 rounded-2xl border p-2 shadow-2xl backdrop-blur-2xl ${
              isDark
                ? 'border-neutral-800 bg-[#161822]/98 text-neutral-100 shadow-black/90'
                : 'border-slate-300 bg-white/98 text-slate-900 shadow-slate-400/60'
            }`}>
              <div className="px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                OpenAPI v2 (Swagger 2.0 Universal)
              </div>
              <button
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportCollectionOpenAPI();
                }}
                className={`w-full flex flex-col items-start rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                  isDark ? 'hover:bg-emerald-500/15 text-slate-100' : 'hover:bg-emerald-50 text-slate-900'
                }`}
              >
                <span className="font-bold text-emerald-400">Export Collection → OpenAPI v2 (.json)</span>
                <span className="text-[10px] text-slate-400">Portable Swagger 2.0 spec for any REST client</span>
              </button>
              <button
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportRequestOpenAPI();
                }}
                className={`w-full flex flex-col items-start rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                  isDark ? 'hover:bg-emerald-500/15 text-slate-100' : 'hover:bg-emerald-50 text-slate-900'
                }`}
              >
                <span className="font-bold">Export Active Request → OpenAPI v2 (.json)</span>
                <span className="text-[10px] text-slate-400">Single endpoint Swagger 2.0 spec</span>
              </button>

              <div className={`my-1.5 border-t ${isDark ? 'border-neutral-800' : 'border-slate-200'}`} />
              <div className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                Collection &amp; Request JSON (v2.1)
              </div>
              <button
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportCollectionJSON();
                }}
                className={`w-full flex flex-col items-start rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                  isDark ? 'hover:bg-neutral-800 text-slate-200' : 'hover:bg-slate-100 text-slate-800'
                }`}
              >
                <span className="font-bold">Export Collection JSON</span>
                <span className="text-[10px] text-slate-400">Includes folders, body types &amp; scripts</span>
              </button>
              <button
                onClick={() => {
                  setIsExportMenuOpen(false);
                  onExportRequest();
                }}
                className={`w-full flex flex-col items-start rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                  isDark ? 'hover:bg-neutral-800 text-slate-200' : 'hover:bg-slate-100 text-slate-800'
                }`}
              >
                <span className="font-bold">Export Active Request JSON</span>
                <span className="text-[10px] text-slate-400">Single request JSON to ~/Downloads</span>
              </button>
            </div>
          )}
        </div>

        {/* Environment Selector */}
        <div className={`flex items-center rounded-xl border p-0.5 text-xs shadow-2xs transition ${
          isDark ? 'border-neutral-800 bg-neutral-950/80' : 'border-slate-300 bg-slate-50'
        }`}>
          <div className="flex items-center pl-2.5 gap-2">
            <span className={`h-2 w-2 rounded-full ${activeEnv ? 'bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse' : 'bg-neutral-500'}`} />
            <select
              value={activeEnvId}
              onChange={(e) => onSelectEnv(e.target.value)}
              className={`bg-transparent py-1 pr-2 text-xs font-bold focus:outline-none cursor-pointer ${
                isDark ? 'text-neutral-200' : 'text-slate-800'
              }`}
            >
              <option value="" className={isDark ? 'bg-neutral-900 text-neutral-400' : 'bg-white text-slate-400'}>
                No Environment
              </option>
              {environments.map((env) => (
                <option
                  key={env.id}
                  value={env.id}
                  className={isDark ? 'bg-neutral-900 text-neutral-200' : 'bg-white text-slate-800'}
                >
                  {env.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={onOpenEnvModal}
            className={`rounded-lg p-1.5 transition ${
              isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
            title="Configure Environment Variables"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 1. DIRECT 1-CLICK THEME TOGGLE BUTTON (Dark 🌙 <-> Light ☀️) */}
        <button
          onClick={toggleMode}
          className={`flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition shadow-xs cursor-pointer ${
            isDark
              ? 'border-neutral-800 bg-[#161822] text-violet-300 hover:bg-violet-600/20 hover:text-white hover:border-violet-500/50'
              : 'border-slate-300 bg-white text-amber-600 hover:bg-amber-50 hover:border-amber-400 shadow-xs'
          }`}
          title={`Click to switch to ${isDark ? 'Light' : 'Dark'} Mode (1-Click Toggle)`}
        >
          {isDark ? (
            <>
              <Moon className="h-4 w-4 text-violet-400" />
              <span>Dark</span>
            </>
          ) : (
            <>
              <Sun className="h-4 w-4 text-amber-500" />
              <span className="text-slate-800">Light</span>
            </>
          )}
        </button>

        {/* 2. PALETTE CUSTOMIZER DROPDOWN */}
        <div className="relative" ref={themeMenuRef}>
          <button
            onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
            className={`flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition shadow-xs cursor-pointer ${
              isDark
                ? 'border-neutral-800 bg-[#161822] text-neutral-300 hover:bg-neutral-800 hover:text-white'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
            }`}
            title="Pick Accent Color & Palette"
          >
            <span
              className="h-3 w-3 rounded-full shadow-xs ring-1 ring-white/30"
              style={{ backgroundColor: accentDef.hex }}
            />
            <Palette className="h-3.5 w-3.5 opacity-80" />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </button>

          {/* Theme Dropdown Menu */}
          {isThemeMenuOpen && (
            <div className={`absolute right-0 top-10 z-50 w-72 rounded-2xl border p-4 shadow-2xl backdrop-blur-2xl transition animate-in fade-in zoom-in-95 duration-150 ${
              isDark
                ? 'border-neutral-800 bg-[#161822]/98 text-neutral-100 shadow-black/90'
                : 'border-slate-300 bg-white/98 text-slate-900 shadow-slate-400/60'
            }`}>
              {/* Header */}
              <div className={`flex items-center justify-between pb-3 border-b mb-3 ${
                isDark ? 'border-neutral-800' : 'border-slate-200'
              }`}>
                <div className="flex items-center gap-2 text-xs font-black tracking-wide">
                  <Palette className="h-4 w-4 text-violet-400" />
                  <span>Pulse Themes</span>
                </div>
                <span className="text-[10px] text-violet-400 font-bold uppercase">Palette</span>
              </div>

              {/* Mode Toggle (Dark / Light) */}
              <div className="mb-4">
                <span className={`text-[11px] font-bold block mb-2 ${isDark ? 'text-neutral-400' : 'text-slate-600'}`}>
                  Theme Mode
                </span>
                <div className={`grid grid-cols-2 gap-2 rounded-xl p-1 border ${
                  isDark ? 'border-neutral-800 bg-neutral-950' : 'border-slate-200 bg-slate-100'
                }`}>
                  <button
                    onClick={() => {
                      setMode('dark');
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition cursor-pointer ${
                      isDark
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    <span>Dark</span>
                  </button>
                  <button
                    onClick={() => {
                      setMode('light');
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition cursor-pointer ${
                      !isDark
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    <span>Light</span>
                  </button>
                </div>
              </div>

              {/* Accent Color Swatches */}
              <div>
                <span className={`text-[11px] font-bold block mb-2.5 ${isDark ? 'text-neutral-400' : 'text-slate-600'}`}>
                  Accent Color
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(ACCENTS) as AccentColor[]).map((accKey) => {
                    const acc = ACCENTS[accKey];
                    const isSelected = accent === accKey;
                    return (
                      <button
                        key={accKey}
                        onClick={() => setAccent(accKey)}
                        className={`flex items-center gap-2 rounded-xl p-2 text-xs font-bold border transition cursor-pointer ${
                          isSelected
                            ? isDark
                              ? 'border-violet-500 bg-violet-500/20 text-white shadow-xs'
                              : 'border-violet-600 bg-violet-100 text-violet-900 shadow-xs'
                            : isDark
                              ? 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-full shrink-0 flex items-center justify-center shadow-xs"
                          style={{ backgroundColor: acc.hex }}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                        </span>
                        <span className="truncate text-[11px]">{acc.name.split(' ')[1]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen Button */}
        <button
          onClick={onToggleFullscreen}
          className={`flex h-8 w-8 items-center justify-center rounded-xl border transition shadow-2xs ${
            isDark
              ? 'border-neutral-800 bg-[#161822] text-neutral-300 hover:bg-neutral-800 hover:text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
          title="Toggle Fullscreen (F11 / Cmd+Shift+F)"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </header>
  );
};
