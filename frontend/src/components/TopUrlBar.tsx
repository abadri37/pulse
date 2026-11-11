import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Environment, HttpMethod, RequestItem } from '../types';
import { useTheme } from '../context/ThemeContext';
import { buildCurlCommand, copyTextToClipboard } from '../utils/curlBuilder';
import {
  applyEnvVarSuggestion,
  filterEnvVarSuggestions,
  findEnvVarTrigger,
  resolveEnvTemplate,
} from '../utils/envVars';
import { EnvVarDropdown, EnvVarTooltip } from './EnvVarOverlay';
import {
  Send,
  Loader2,
  Save,
  Check,
  Terminal,
  Columns2,
  Rows2,
  Plus,
  X,
  Copy,
} from 'lucide-react';

interface Props {
  request: RequestItem;
  activeEnv?: Environment;
  onMethodChange: (method: HttpMethod) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onSave: () => void;
  isLoading: boolean;
  isSavedRecently: boolean;
  isCurlOpen: boolean;
  onToggleCurl: () => void;
  layoutMode: 'side' | 'stacked';
  onToggleLayout: () => void;
  openTabs: RequestItem[];
  activeRequestId: string;
  onSelectTab: (req: RequestItem) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseAllTabs: () => void;
  onNewTab: () => void;
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-[#10b981]',
  POST: 'text-[#8b5cf6]',
  PUT: 'text-[#f59e0b]',
  PATCH: 'text-[#06b6d4]',
  DELETE: 'text-[#f43f5e]',
  OPTIONS: 'text-slate-400',
  HEAD: 'text-teal-400',
};

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

export const TopUrlBar: React.FC<Props> = ({
  request,
  activeEnv,
  onMethodChange,
  onUrlChange,
  onSend,
  onSave,
  isLoading,
  isSavedRecently,
  isCurlOpen,
  onToggleCurl,
  layoutMode,
  onToggleLayout,
  openTabs,
  activeRequestId,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onNewTab,
}) => {
  const { isDark } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabContextMenuRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState<number>(request.url.length);
  const [isFocused, setIsFocused] = useState(false);
  const [isAutocompleteDismissed, setIsAutocompleteDismissed] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [isCurlCopied, setIsCurlCopied] = useState(false);
  const [hoveredVar, setHoveredVar] = useState<{
    name: string;
    value: string;
    resolved: boolean;
    x: number;
  } | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{
    tab: RequestItem;
    x: number;
    y: number;
  } | null>(null);

  const envVars = activeEnv?.variables || {};
  const varEntries = useMemo(() => Object.entries(envVars), [envVars]);

  // Keep scroll position synced between transparent input and highlighted mirror
  const syncScroll = () => {
    if (inputRef.current && mirrorRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  useEffect(() => {
    syncScroll();
  }, [request.url]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsAutocompleteDismissed(true);
        setIsFocused(false);
      }
      if (tabContextMenuRef.current && !tabContextMenuRef.current.contains(e.target as Node)) {
        setTabContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopyCurl = async (targetReq: RequestItem = request) => {
    const cmd = buildCurlCommand(targetReq, activeEnv);
    const ok = await copyTextToClipboard(cmd);
    if (ok) {
      setIsCurlCopied(true);
      setTimeout(() => setIsCurlCopied(false), 1800);
    }
  };

  // Detect variable trigger before cursor using shared helper
  const trigger = useMemo(() => {
    if (!isFocused || isAutocompleteDismissed) return null;
    return findEnvVarTrigger(request.url, cursorPos, varEntries, {
      allowBarePrefix: true,
      allowJsScriptKey: false,
    });
  }, [isFocused, isAutocompleteDismissed, varEntries, request.url, cursorPos]);

  const suggestions = useMemo(
    () => filterEnvVarSuggestions(trigger, varEntries),
    [trigger, varEntries]
  );

  useEffect(() => {
    setHighlightedIdx(0);
  }, [trigger?.query, trigger?.start]);

  const showDropdown = !!trigger && suggestions.length > 0;

  const insertVariable = (varName: string) => {
    if (!trigger) return;
    const { nextText: nextUrl, nextCursor } = applyEnvVarSuggestion(request.url, trigger, varName);

    onUrlChange(nextUrl);
    setIsAutocompleteDismissed(true);
    setCursorPos(nextCursor);

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(nextCursor, nextCursor);
        syncScroll();
      }
    });
  };

  // Compute resolved URL preview when `{{...}}` placeholders exist
  const hasVariablesInUrl = /\{\{[^}]+\}\}/.test(request.url);
  const resolvedPreview = useMemo(() => {
    if (!hasVariablesInUrl) return '';
    return resolveEnvTemplate(request.url, envVars);
  }, [request.url, envVars, hasVariablesInUrl]);

  // Render URL text segments with identical character metrics to `<input>`
  const highlightedSegments = useMemo(() => {
    if (!request.url) return null;
    const parts = request.url.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, idx) => {
      const match = part.match(/^\{\{([^}]+)\}\}$/);
      if (match) {
        const varKey = match[1].trim();
        const isResolved = Object.prototype.hasOwnProperty.call(envVars, varKey);
        return (
          <span
            key={idx}
            data-var-name={varKey}
            className={
              isResolved
                ? isDark
                  ? 'rounded-[3px] bg-emerald-500/20 text-emerald-400'
                  : 'rounded-[3px] bg-emerald-500/15 text-emerald-700'
                : isDark
                  ? 'rounded-[3px] bg-amber-500/20 text-amber-300'
                  : 'rounded-[3px] bg-amber-500/20 text-amber-700'
            }
          >
            {part}
          </span>
        );
      }
      return (
        <span key={idx} className={isDark ? 'text-slate-100' : 'text-slate-900'}>
          {part}
        </span>
      );
    });
  }, [request.url, envVars, isDark]);

  return (
    <div className={`flex flex-col border-b select-none transition-colors duration-200 shrink-0 ${
      isDark ? 'border-neutral-800/80 bg-[#161924]' : 'border-slate-200 bg-slate-100/90'
    }`}>
      {/* 1. Request Tabs Row (e.g. GET Echo Server, POST usersIdLike, +) */}
      <div className={`flex items-center border-b px-2 overflow-x-auto gap-1 text-xs font-bold ${
        isDark ? 'border-neutral-800/80 bg-[#11131a]' : 'border-slate-200 bg-slate-200/60'
      }`}>
        <div className="flex items-center gap-1 flex-1 overflow-x-auto py-1">
          {openTabs.map((tab) => {
            const isActive = tab.id === activeRequestId;
            const methodColor = METHOD_COLORS[tab.method] || 'text-[#10b981]';

            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setTabContextMenu({ tab, x: e.clientX, y: e.clientY });
                }}
                title="Right-click for Close All / Close Others / Copy cURL"
                className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 cursor-pointer text-xs transition border ${
                  isActive
                    ? isDark
                      ? 'border-neutral-700 bg-[#181b26] text-white shadow-2xs font-extrabold'
                      : 'border-slate-300 bg-white text-slate-900 shadow-2xs font-extrabold'
                    : isDark
                      ? 'border-transparent text-slate-400 hover:bg-neutral-800/60 hover:text-slate-200'
                      : 'border-transparent text-slate-600 hover:bg-slate-300/60 hover:text-slate-900'
                }`}
              >
                <span className={`text-[10px] font-black tracking-wider ${methodColor}`}>
                  {tab.method}
                </span>
                <span className="truncate max-w-[160px]">{tab.name || 'Untitled Request'}</span>
                {openTabs.length > 1 && (
                  <button
                    onClick={(e) => onCloseTab(tab.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-white hover:bg-neutral-700 transition"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* New Tab (+) Button */}
          <button
            onClick={onNewTab}
            className={`p-1.5 rounded-lg transition ${
              isDark ? 'text-slate-400 hover:text-white hover:bg-neutral-800' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300'
            }`}
            title="Open New Request Tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Layout Toggle (Side-by-Side ◫ vs Stacked Rows ⬒) */}
        <div className="flex items-center gap-1 shrink-0 pl-2">
          <button
            onClick={onToggleLayout}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition shadow-2xs ${
              isDark
                ? 'border-neutral-700/80 bg-[#181b26] text-slate-300 hover:text-white hover:bg-neutral-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            title={layoutMode === 'side' ? 'Switch to Stacked Rows' : 'Switch to Side-by-Side'}
          >
            {layoutMode === 'side' ? <Rows2 className="h-3.5 w-3.5 text-violet-400" /> : <Columns2 className="h-3.5 w-3.5 text-violet-400" />}
            <span>{layoutMode === 'side' ? 'Stacked Rows' : 'Side-by-Side'}</span>
          </button>
        </div>
      </div>

      {/* Full-Width URL Input Bar */}
      <div className="flex items-center gap-2 p-2.5">
        {/* Method Dropdown */}
        <div className="relative shrink-0">
          <select
            value={request.method}
            onChange={(e) => onMethodChange(e.target.value as HttpMethod)}
            className={`h-9.5 rounded-xl border px-3 text-xs font-black tracking-wider focus:outline-none cursor-pointer transition shadow-2xs ${
              isDark ? 'bg-[#11131a] border-neutral-700/80' : 'bg-white border-slate-300'
            } ${METHOD_COLORS[request.method]}`}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} className={isDark ? 'bg-neutral-900 text-white' : 'bg-white text-slate-900'}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Complete Full-Width URL Input Box with Variable Highlighting & Autocomplete */}
        <div ref={containerRef} className="relative flex-1 min-w-0">
          <div className={`relative flex items-center h-9.5 rounded-xl border px-3.5 transition shadow-inner ${
            isDark
              ? 'border-neutral-700/80 bg-[#11131a] focus-within:border-violet-500'
              : 'border-slate-300 bg-white focus-within:border-violet-500 shadow-2xs'
          }`}>
            {/* Highlight Mirror Backdrop */}
            <div
              ref={mirrorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3.5 right-3.5 flex items-center overflow-hidden whitespace-pre font-mono text-xs font-semibold tracking-normal"
            >
              {highlightedSegments}
            </div>

            {/* Real Interactive Transparent-Text Input */}
            <input
              ref={inputRef}
              type="text"
              value={request.url}
              onFocus={(e) => {
                setIsFocused(true);
                setIsAutocompleteDismissed(false);
                setCursorPos(e.target.selectionStart ?? request.url.length);
              }}
              onClick={(e) => {
                const pos = (e.target as HTMLInputElement).selectionStart ?? request.url.length;
                setCursorPos(pos);
                setIsAutocompleteDismissed(false);
                syncScroll();
              }}
              onScroll={() => {
                syncScroll();
                setHoveredVar(null);
              }}
              onMouseMove={(e) => {
                if (!mirrorRef.current || !containerRef.current) return;
                const spans = mirrorRef.current.querySelectorAll<HTMLElement>('[data-var-name]');
                const containerRect = containerRef.current.getBoundingClientRect();
                let hit: typeof hoveredVar = null;
                for (let i = 0; i < spans.length; i++) {
                  const r = spans[i].getBoundingClientRect();
                  if (e.clientX >= r.left && e.clientX <= r.right) {
                    const name = spans[i].dataset.varName || '';
                    const resolved = Object.prototype.hasOwnProperty.call(envVars, name);
                    hit = {
                      name,
                      value: resolved ? envVars[name] : '',
                      resolved,
                      x: Math.max(0, r.left - containerRect.left),
                    };
                    break;
                  }
                }
                setHoveredVar(hit);
              }}
              onMouseLeave={() => setHoveredVar(null)}
              onChange={(e) => {
                setIsAutocompleteDismissed(false);
                setCursorPos(e.target.selectionStart ?? e.target.value.length);
                onUrlChange(e.target.value);
                requestAnimationFrame(syncScroll);
              }}
              onKeyUp={(e) => {
                setCursorPos((e.target as HTMLInputElement).selectionStart ?? request.url.length);
                syncScroll();
              }}
              onKeyDown={(e) => {
                if (showDropdown) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIdx((prev) => (prev + 1) % suggestions.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedIdx((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && trigger?.hasBraces)) {
                    e.preventDefault();
                    const picked = suggestions[highlightedIdx] || suggestions[0];
                    if (picked) insertVariable(picked[0]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsAutocompleteDismissed(true);
                    return;
                  }
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  onSend();
                }
              }}
              placeholder="Enter complete request URL or type {{ to pick an env variable"
              className={`relative z-10 w-full bg-transparent font-mono text-xs font-semibold tracking-normal select-text focus:outline-none text-transparent ${
                isDark
                  ? 'caret-white placeholder-slate-500'
                  : 'caret-slate-900 placeholder-slate-400'
              }`}
            />

            {/* Quick `{{}}` Variable Picker Button */}
            {varEntries.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (inputRef.current) {
                    const pos = inputRef.current.selectionStart ?? request.url.length;
                    const needsBraces = !request.url.slice(0, pos).endsWith('{{');
                    const nextUrl = needsBraces
                      ? request.url.slice(0, pos) + '{{' + request.url.slice(pos)
                      : request.url;
                    const nextPos = needsBraces ? pos + 2 : pos;
                    if (needsBraces) onUrlChange(nextUrl);
                    setIsFocused(true);
                    setIsAutocompleteDismissed(false);
                    setCursorPos(nextPos);
                    requestAnimationFrame(() => {
                      if (inputRef.current) {
                        inputRef.current.focus();
                        inputRef.current.setSelectionRange(nextPos, nextPos);
                      }
                    });
                  }
                }}
                className={`relative z-10 ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold transition cursor-pointer ${
                  isDark
                    ? 'bg-neutral-800/80 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-slate-100 text-emerald-700 hover:bg-emerald-100'
                }`}
                title={`Insert environment variable (${activeEnv?.name || 'Active Env'})`}
              >
                {'{{ }}'}
              </button>
            )}
          </div>

          {/* Environment Variables Autocomplete Dropdown */}
          {showDropdown && (
            <EnvVarDropdown
              suggestions={suggestions}
              highlightedIdx={highlightedIdx}
              onHighlight={setHighlightedIdx}
              onSelect={insertVariable}
              envName={activeEnv?.name}
              triggerMode={trigger?.mode}
              isDark={isDark}
              className="absolute left-0 right-0 top-full mt-1.5"
            />
          )}

          {/* Hover Tooltip showing exact {{variable}} value */}
          {hoveredVar && !showDropdown && (
            <EnvVarTooltip
              hoveredVar={{
                name: hoveredVar.name,
                value: hoveredVar.value,
                resolved: hoveredVar.resolved,
                left: hoveredVar.x,
                top: 42,
              }}
              envName={activeEnv?.name}
              isDark={isDark}
              positionMode="absolute"
            />
          )}

          {/* Resolved URL Live Preview Bar (when focused & URL uses env variables without variable hover) */}
          {isFocused && hasVariablesInUrl && !showDropdown && !hoveredVar && (
            <div className={`absolute left-0 top-full mt-1 z-40 max-w-full rounded-lg border px-2.5 py-1 text-[11px] font-mono shadow-lg flex items-center gap-2 ${
              isDark
                ? 'border-neutral-800 bg-[#11131a]/95 text-slate-300'
                : 'border-slate-300 bg-white/95 text-slate-700'
            }`}>
              <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-emerald-400 shrink-0">
                {activeEnv?.name || 'Env'} →
              </span>
              <span className="truncate">{resolvedPreview}</span>
            </div>
          )}
        </div>

        {/* Copy Request as cURL Button */}
        <button
          onClick={() => handleCopyCurl(request)}
          className={`flex h-9.5 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition shadow-2xs shrink-0 cursor-pointer ${
            isCurlCopied
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : isDark
                ? 'border-neutral-700/80 bg-[#11131a] text-cyan-300 hover:text-white hover:bg-neutral-800'
                : 'border-slate-300 bg-white text-cyan-700 hover:bg-cyan-50'
          }`}
          title="Copy active request as cURL command to clipboard"
        >
          {isCurlCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{isCurlCopied ? 'Copied cURL' : 'Copy cURL'}</span>
        </button>

        {/* cURL Import Drawer Toggle */}
        <button
          onClick={onToggleCurl}
          className={`flex h-9.5 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition shadow-2xs shrink-0 cursor-pointer ${
            isCurlOpen
              ? 'bg-violet-600 text-white border-violet-500'
              : isDark
                ? 'border-neutral-700/80 bg-[#11131a] text-slate-300 hover:text-white hover:bg-neutral-800'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
          title="Import / Paste cURL Command"
        >
          <Terminal className="h-3.5 w-3.5" />
          <span>cURL</span>
        </button>

        {/* Save Button */}
        <button
          onClick={onSave}
          className={`flex h-9.5 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition shadow-2xs shrink-0 ${
            isSavedRecently
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
              : isDark
                ? 'border-neutral-700/80 bg-[#11131a] text-slate-300 hover:text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
          }`}
          title="Save Request to Disk (Cmd+S / Ctrl+S)"
        >
          {isSavedRecently ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Save className="h-3.5 w-3.5" />}
          <span>{isSavedRecently ? 'Saved' : 'Save'}</span>
        </button>

        {/* Pulse Send Button */}
        <button
          onClick={onSend}
          disabled={isLoading || !request.url}
          className="flex h-9.5 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-5 text-xs font-black text-white shadow-md shadow-violet-500/25 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 shrink-0"
          title="Execute Request (Cmd+Enter / Ctrl+Enter)"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          <span>Send ▾</span>
        </button>
      </div>

      {/* Tab Right-Click Context Menu */}
      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          className={`fixed z-50 w-52 rounded-xl border p-1.5 shadow-2xl text-xs ${
            isDark
              ? 'border-neutral-800 bg-[#161924] text-slate-200 shadow-black/90'
              : 'border-slate-300 bg-white text-slate-800 shadow-slate-400/50'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              handleCopyCurl(tabContextMenu.tab);
              setTabContextMenu(null);
            }}
            className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition cursor-pointer ${
              isDark ? 'hover:bg-neutral-800' : 'hover:bg-slate-100'
            }`}
          >
            <Copy className="h-3.5 w-3.5 text-cyan-400" />
            <span>Copy as cURL</span>
          </button>
          <div className={`my-1 border-t ${isDark ? 'border-neutral-800' : 'border-slate-200'}`} />
          <button
            type="button"
            onClick={(e) => {
              onCloseTab(tabContextMenu.tab.id, e);
              setTabContextMenu(null);
            }}
            className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition cursor-pointer ${
              isDark ? 'hover:bg-neutral-800' : 'hover:bg-slate-100'
            }`}
          >
            <span>Close Tab</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseOtherTabs(tabContextMenu.tab.id);
              setTabContextMenu(null);
            }}
            className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition cursor-pointer ${
              isDark ? 'hover:bg-neutral-800' : 'hover:bg-slate-100'
            }`}
          >
            <span>Close Other Tabs</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onCloseAllTabs();
              setTabContextMenu(null);
            }}
            className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-semibold transition cursor-pointer ${
              isDark ? 'text-rose-400 hover:bg-rose-500/15' : 'text-rose-600 hover:bg-rose-50'
            }`}
          >
            <span>Close All Tabs</span>
          </button>
        </div>
      )}
    </div>
  );
};
