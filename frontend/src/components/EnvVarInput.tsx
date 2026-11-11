import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Environment } from '../types';
import { useTheme } from '../context/ThemeContext';
import {
  applyEnvVarSuggestion,
  filterEnvVarSuggestions,
  findEnvVarTrigger,
} from '../utils/envVars';
import { EnvVarDropdown, EnvVarTooltip, HoveredVarInfo } from './EnvVarOverlay';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  activeEnv?: Environment;
}

export const EnvVarInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder = '',
  activeEnv,
}) => {
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState<number>(value.length);
  const [isFocused, setIsFocused] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [dropdownRect, setDropdownRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hoveredVar, setHoveredVar] = useState<HoveredVarInfo | null>(null);

  const envVars = activeEnv?.variables || {};
  const varEntries = useMemo(() => Object.entries(envVars), [envVars]);

  const syncScroll = () => {
    if (inputRef.current && mirrorRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  useEffect(() => {
    syncScroll();
  }, [value]);

  const trigger = useMemo(() => {
    if (!isFocused || isDismissed) return null;
    return findEnvVarTrigger(value, cursorPos, varEntries, {
      allowBarePrefix: true,
      allowJsScriptKey: false,
    });
  }, [isFocused, isDismissed, value, cursorPos, varEntries]);

  const suggestions = useMemo(
    () => filterEnvVarSuggestions(trigger, varEntries),
    [trigger, varEntries]
  );

  useEffect(() => {
    setHighlightedIdx(0);
  }, [trigger?.query, trigger?.start]);

  const showDropdown = !!trigger && suggestions.length > 0;

  useEffect(() => {
    if (showDropdown && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownRect({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(260, rect.width),
      });
    } else {
      setDropdownRect(null);
    }
  }, [showDropdown, value, cursorPos]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDismissed(true);
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const insertVariable = (varName: string) => {
    if (!trigger) return;
    const { nextText, nextCursor } = applyEnvVarSuggestion(value, trigger, varName);
    onChange(nextText);
    setIsDismissed(true);
    setCursorPos(nextCursor);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(nextCursor, nextCursor);
        syncScroll();
      }
    });
  };

  const highlightedSegments = useMemo(() => {
    if (!value) return null;
    const parts = value.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, idx) => {
      const m = part.match(/^\{\{([^}]+)\}\}$/);
      if (m) {
        const varKey = m[1].trim();
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
        <span key={idx} className={isDark ? 'text-neutral-100' : 'text-neutral-900'}>
          {part}
        </span>
      );
    });
  }, [value, envVars, isDark]);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-md transition ${
        isFocused
          ? isDark
            ? 'bg-neutral-800 ring-1 ring-violet-500/50'
            : 'bg-slate-100 ring-1 ring-violet-500/50'
          : ''
      }`}
    >
      {/* Highlight mirror backdrop */}
      <div
        ref={mirrorRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-2 right-2 flex items-center overflow-hidden whitespace-pre font-mono text-xs font-normal tracking-normal"
      >
        {highlightedSegments}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onFocus={(e) => {
          setIsFocused(true);
          setIsDismissed(false);
          setCursorPos(e.target.selectionStart ?? value.length);
        }}
        onClick={(e) => {
          setCursorPos((e.target as HTMLInputElement).selectionStart ?? value.length);
          setIsDismissed(false);
          syncScroll();
        }}
        onScroll={() => {
          syncScroll();
          setHoveredVar(null);
        }}
        onMouseMove={(e) => {
          if (!mirrorRef.current) return;
          const spans = mirrorRef.current.querySelectorAll<HTMLElement>('[data-var-name]');
          let hit: HoveredVarInfo | null = null;
          for (let i = 0; i < spans.length; i++) {
            const r = spans[i].getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right) {
              const name = spans[i].dataset.varName || '';
              const resolved = Object.prototype.hasOwnProperty.call(envVars, name);
              hit = {
                name,
                value: resolved ? envVars[name] : '',
                resolved,
                left: r.left,
                top: r.bottom + 4,
              };
              break;
            }
          }
          setHoveredVar(hit);
        }}
        onMouseLeave={() => setHoveredVar(null)}
        onChange={(e) => {
          setIsDismissed(false);
          setCursorPos(e.target.selectionStart ?? e.target.value.length);
          onChange(e.target.value);
          requestAnimationFrame(syncScroll);
        }}
        onKeyUp={(e) => {
          setCursorPos((e.target as HTMLInputElement).selectionStart ?? value.length);
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
            if (
              e.key === 'Tab' ||
              (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && trigger?.hasBraces)
            ) {
              e.preventDefault();
              const picked = suggestions[highlightedIdx] || suggestions[0];
              if (picked) insertVariable(picked[0]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setIsDismissed(true);
              return;
            }
          }
        }}
        className={`relative z-10 w-full rounded-md bg-transparent px-2 py-1 font-mono text-xs font-normal tracking-normal select-text focus:outline-none text-transparent ${
          isDark
            ? 'caret-white placeholder-neutral-600'
            : 'caret-slate-900 placeholder-neutral-400'
        }`}
      />

      {showDropdown && dropdownRect && (
        <EnvVarDropdown
          suggestions={suggestions}
          highlightedIdx={highlightedIdx}
          onHighlight={setHighlightedIdx}
          onSelect={insertVariable}
          envName={activeEnv?.name}
          triggerMode={trigger?.mode}
          isDark={isDark}
          style={{
            position: 'fixed',
            left: dropdownRect.left,
            top: dropdownRect.top,
            width: dropdownRect.width,
          }}
        />
      )}

      {hoveredVar && !showDropdown && (
        <EnvVarTooltip
          hoveredVar={hoveredVar}
          envName={activeEnv?.name}
          isDark={isDark}
          positionMode="fixed"
        />
      )}
    </div>
  );
};
