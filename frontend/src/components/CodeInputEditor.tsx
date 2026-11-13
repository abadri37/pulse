import React, { useState, useRef, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Environment } from '../types';
import {
  applyEnvVarSuggestion,
  filterEnvVarSuggestions,
  findEnvVarTrigger,
} from '../utils/envVars';
import { EnvVarDropdown, EnvVarTooltip, HoveredVarInfo } from './EnvVarOverlay';

export type CodeLanguage = 'json' | 'xml' | 'graphql' | 'form' | 'raw' | 'js';

interface Props {
  value: string;
  onChange: (val: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  isDark?: boolean;
  activeEnv?: Environment;
  minHeightClass?: string;
}

interface FoldableBlock {
  startLine: number;
  endLine: number;
  lineCount: number;
  openLabel: string;
  closeLabel: string;
  prefix: string;
  trailingComma: boolean;
}

const findMatchingBrace = (text: string, cursor: number): Set<number> => {
  const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const revPairs: Record<string, string> = { '}': '{', ']': '[', ')': '(' };
  const matched = new Set<number>();

  const checkIdx = (idx: number) => {
    if (idx < 0 || idx >= text.length) return false;
    const ch = text[idx];
    if (pairs[ch]) {
      const target = pairs[ch];
      let depth = 0;
      for (let i = idx; i < text.length; i++) {
        if (text[i] === ch) depth++;
        else if (text[i] === target) {
          depth--;
          if (depth === 0) {
            matched.add(idx);
            matched.add(i);
            return true;
          }
        }
      }
    } else if (revPairs[ch]) {
      const target = revPairs[ch];
      let depth = 0;
      for (let i = idx; i >= 0; i--) {
        if (text[i] === ch) depth++;
        else if (text[i] === target) {
          depth--;
          if (depth === 0) {
            matched.add(idx);
            matched.add(i);
            return true;
          }
        }
      }
    }
    return false;
  };

  if (!checkIdx(cursor)) {
    checkIdx(cursor - 1);
  }
  return matched;
};

const computeFoldableBlocks = (lines: string[], language: CodeLanguage): FoldableBlock[] => {
  const blocks: FoldableBlock[] = [];

  if (language === 'xml') {
    const stack: { lineIdx: number; tagName: string }[] = [];
    const openTagRegex = /^<([a-zA-Z0-9_:\-]+)(?:\s+[^>]*)?>$/;
    const closeTagRegex = /^<\/([a-zA-Z0-9_:\-]+)>$/;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('<?') || trimmed.startsWith('<!--') || trimmed.endsWith('/>')) return;
      const openMatch = trimmed.match(openTagRegex);
      if (openMatch && !trimmed.includes(`</${openMatch[1]}>`)) {
        stack.push({ lineIdx: idx, tagName: openMatch[1] });
        return;
      }
      const closeMatch = trimmed.match(closeTagRegex);
      if (closeMatch && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.tagName === closeMatch[1]) {
          stack.pop();
          const lineCount = idx - top.lineIdx;
          if (lineCount > 0) {
            blocks.push({
              startLine: top.lineIdx,
              endLine: idx,
              lineCount,
              openLabel: `<${top.tagName}>`,
              closeLabel: `</${closeMatch[1]}>`,
              prefix: '',
              trailingComma: false,
            });
          }
        }
      }
    });
    return blocks;
  }

  // Brace/bracket block folding for JSON, GraphQL, JS
  const stack: { lineIdx: number; char: '{' | '[' }[] = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/[{\[]$/.test(trimmed)) {
      const openChar = trimmed.endsWith('{') ? '{' : '[';
      stack.push({ lineIdx: idx, char: openChar });
    }
    if (/^[}\]]/.test(trimmed) && stack.length > 0) {
      const openItem = stack.pop();
      if (
        openItem &&
        ((openItem.char === '{' && trimmed.startsWith('}')) ||
          (openItem.char === '[' && trimmed.startsWith(']')))
      ) {
        const lineCount = idx - openItem.lineIdx;
        if (lineCount > 0) {
          const firstLine = lines[openItem.lineIdx];
          blocks.push({
            startLine: openItem.lineIdx,
            endLine: idx,
            lineCount,
            openLabel: openItem.char,
            closeLabel: openItem.char === '{' ? '}' : ']',
            prefix: firstLine.substring(0, firstLine.lastIndexOf(openItem.char)),
            trailingComma: trimmed.endsWith(','),
          });
        }
      }
    }
  });
  return blocks;
};

// Imperative handle so callers (e.g. "Sample JSON" preset buttons) can programmatically
// replace the editor's content while preserving the browser's native undo (Ctrl+Z) history.
// Simply updating the `value` prop sets the textarea's value directly, which clears/bypasses
// the undo stack; `document.execCommand('insertText', ...)` instead simulates a user edit.
export interface CodeInputEditorHandle {
  replaceValue: (newValue: string) => void;
}

export const CodeInputEditor = forwardRef<CodeInputEditorHandle, Props>(({
  value,
  onChange,
  language,
  placeholder = '',
  isDark = true,
  activeEnv,
  minHeightClass = 'min-h-[180px]',
}, ref) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const [cursorPos, setCursorPos] = useState<number>(0);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [isAutocompleteDismissed, setIsAutocompleteDismissed] = useState<boolean>(false);
  const [highlightedIdx, setHighlightedIdx] = useState<number>(0);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null);
  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(new Set());
  const [hoveredVar, setHoveredVar] = useState<HoveredVarInfo | null>(null);

  const envVars = activeEnv?.variables || {};
  const varEntries = useMemo(() => Object.entries(envVars), [envVars]);
  const lines = useMemo(() => (value ? value.split('\n') : ['']), [value]);

  const foldableBlocks = useMemo(
    () => computeFoldableBlocks(lines, language),
    [lines, language]
  );

  const blockByStartLine = useMemo(() => {
    const map = new Map<number, FoldableBlock>();
    foldableBlocks.forEach((b) => map.set(b.startLine, b));
    return map;
  }, [foldableBlocks]);

  const matchedBraceIndices = useMemo(
    () => findMatchingBrace(value || '', cursorPos),
    [value, cursorPos]
  );

  const isFoldedView = collapsedLines.size > 0;

  const syncScroll = () => {
    if (!textareaRef.current) return;
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
      mirrorRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useImperativeHandle(ref, () => ({
    replaceValue: (newValue: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        onChange(newValue);
        return;
      }
      ta.focus();
      ta.select();
      let applied = false;
      try {
        applied = document.execCommand('insertText', false, newValue);
      } catch {
        applied = false;
      }
      // Fallback for environments where execCommand is unavailable/no-op (undo history
      // won't be preserved in that case, but the content still updates correctly).
      if (!applied || ta.value !== newValue) {
        onChange(newValue);
      }
    },
  }));

  const toggleFold = (lineIdx: number) => {
    setCollapsedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineIdx)) next.delete(lineIdx);
      else next.add(lineIdx);
      return next;
    });
  };

  // Highlight `{{var}}` inside plain string fragments without changing glyph metrics
  const renderEnvVarSpans = (chunk: string, baseColor: string, keyPrefix: string) => {
    if (!chunk.includes('{{')) {
      return (
        <span key={keyPrefix} className={baseColor}>
          {chunk}
        </span>
      );
    }
    const parts = chunk.split(/(\{\{[^}]+\}\})/g);
    return parts.map((p, idx) => {
      const m = p.match(/^\{\{([^}]+)\}\}$/);
      if (m) {
        const varKey = m[1].trim();
        const isResolved = Object.prototype.hasOwnProperty.call(envVars, varKey);
        return (
          <span
            key={`${keyPrefix}_ev_${idx}`}
            data-var-name={varKey}
            className={
              isResolved
                ? isDark
                  ? 'rounded-[3px] bg-emerald-500/20 text-emerald-300'
                  : 'rounded-[3px] bg-emerald-500/15 text-emerald-700'
                : isDark
                  ? 'rounded-[3px] bg-amber-500/20 text-amber-300'
                  : 'rounded-[3px] bg-amber-500/20 text-amber-700'
            }
          >
            {p}
          </span>
        );
      }
      return (
        <span key={`${keyPrefix}_tx_${idx}`} className={baseColor}>
          {p}
        </span>
      );
    });
  };

  // Render a single line keeping exact character metrics (`font-normal`, no extra padding)
  const renderLineTokens = (lineText: string, lineStartOffset: number, lineKey: number) => {
    if (lineText === '') return '\u200b';

    const wrapWithMatchHighlight = (node: React.ReactNode, charOffset: number, len: number, key: string) => {
      if (len === 1 && matchedBraceIndices.has(charOffset)) {
        return (
          <span
            key={key}
            className={
              isDark
                ? 'rounded-[2px] bg-violet-500/35 text-white ring-1 ring-violet-400/70'
                : 'rounded-[2px] bg-violet-200 text-violet-950 ring-1 ring-violet-500/60'
            }
          >
            {node}
          </span>
        );
      }
      return node;
    };

    if (language === 'xml') {
      const xmlRegex = /(<!--[\s\S]*?-->|<\?[^>]*\?>|<\/?[a-zA-Z0-9_:\-]+|\/?>|"[^"]*"|'[^']*'|[a-zA-Z0-9_:\-]+(?=\s*=)|=\s*|[^<>\s]+|\s+)/g;
      const parts: React.ReactNode[] = [];
      let match: RegExpExecArray | null;
      while ((match = xmlRegex.exec(lineText)) !== null) {
        const token = match[0];
        let color = isDark ? 'text-slate-200' : 'text-slate-800';
        if (token.startsWith('<!--')) {
          color = isDark ? 'text-slate-500' : 'text-slate-400';
        } else if (token.startsWith('<?')) {
          color = isDark ? 'text-purple-400' : 'text-purple-700';
        } else if (token.startsWith('<') || token === '>' || token === '/>') {
          color = isDark ? 'text-sky-400' : 'text-sky-700';
        } else if (token.startsWith('"') || token.startsWith("'")) {
          color = isDark ? 'text-emerald-400' : 'text-emerald-700';
        } else if (/^[a-zA-Z0-9_:\-]+$/.test(token)) {
          color = isDark ? 'text-amber-300' : 'text-amber-700';
        }
        parts.push(renderEnvVarSpans(token, color, `${lineKey}_${match.index}`));
      }
      return parts;
    }

    if (language === 'graphql') {
      const gqlRegex = /(\{\{[^}]+\}\}|#[^\n]*|"[^"]*"|\$[a-zA-Z_][a-zA-Z0-9_]*|\b(?:query|mutation|subscription|fragment|on|true|false|null|ID|String|Int|Float|Boolean)\b|-?\d+(?:\.\d+)?|[{}()\[\]:!,])/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = gqlRegex.exec(lineText)) !== null) {
        if (match.index > lastIndex) {
          parts.push(
            renderEnvVarSpans(
              lineText.slice(lastIndex, match.index),
              isDark ? 'text-slate-200' : 'text-slate-800',
              `${lineKey}_pre_${lastIndex}`
            )
          );
        }
        const token = match[0];
        let color = isDark ? 'text-slate-200' : 'text-slate-800';
        if (token.startsWith('#')) {
          color = isDark ? 'text-slate-500' : 'text-slate-400';
        } else if (token.startsWith('"')) {
          color = isDark ? 'text-emerald-400' : 'text-emerald-700';
        } else if (token.startsWith('$')) {
          color = isDark ? 'text-sky-400' : 'text-sky-700';
        } else if (/^(query|mutation|subscription|fragment|on)$/.test(token)) {
          color = isDark ? 'text-violet-400' : 'text-violet-700';
        } else if (/^(true|false|null)$/.test(token)) {
          color = isDark ? 'text-purple-400' : 'text-purple-700';
        } else if (/^(ID|String|Int|Float|Boolean)$/.test(token)) {
          color = isDark ? 'text-amber-300' : 'text-amber-700';
        } else if (!isNaN(Number(token))) {
          color = isDark ? 'text-amber-400' : 'text-amber-700';
        } else if (/^[{}()\[\]]$/.test(token)) {
          color = isDark ? 'text-violet-300' : 'text-violet-700';
        }
        const rendered = renderEnvVarSpans(token, color, `${lineKey}_${match.index}`);
        parts.push(
          wrapWithMatchHighlight(rendered, lineStartOffset + match.index, token.length, `${lineKey}_m_${match.index}`)
        );
        lastIndex = gqlRegex.lastIndex;
      }
      if (lastIndex < lineText.length) {
        parts.push(
          renderEnvVarSpans(
            lineText.slice(lastIndex),
            isDark ? 'text-slate-200' : 'text-slate-800',
            `${lineKey}_tail`
          )
        );
      }
      return parts;
    }

    if (language === 'form') {
      const pairs = lineText.split(/(&|=)/g);
      return pairs.map((seg, i) => {
        if (seg === '&' || seg === '=') {
          return (
            <span key={`${lineKey}_f_${i}`} className={isDark ? 'text-violet-400' : 'text-violet-700'}>
              {seg}
            </span>
          );
        }
        const isKey = i === 0 || pairs[i - 1] === '&';
        const color = isKey
          ? isDark ? 'text-sky-400' : 'text-sky-700'
          : isDark ? 'text-emerald-400' : 'text-emerald-700';
        return renderEnvVarSpans(seg, color, `${lineKey}_fv_${i}`);
      });
    }

    if (language === 'js') {
      const jsRegex = /(\{\{[^}]+\}\}|\/\/[^\n]*|"[^"]*"|'[^']*'|`[^`]*`|\b(?:const|let|var|function|return|if|else|try|catch|new|true|false|null|undefined|pulse|response)\b|\b\d+(?:\.\d+)?\b|[{}()\[\].,;:=])/g;
      const parts: React.ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = jsRegex.exec(lineText)) !== null) {
        if (match.index > lastIndex) {
          parts.push(
            renderEnvVarSpans(
              lineText.slice(lastIndex, match.index),
              isDark ? 'text-slate-200' : 'text-slate-800',
              `${lineKey}_jspre_${lastIndex}`
            )
          );
        }
        const token = match[0];
        let color = isDark ? 'text-slate-200' : 'text-slate-800';
        if (token.startsWith('//')) {
          color = isDark ? 'text-slate-500' : 'text-slate-400';
        } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
          color = isDark ? 'text-emerald-400' : 'text-emerald-700';
          // Detect pulse.getEnv("var") / setEnv("var") / environment.get("var") string arg for hover inspection
          const prefixBeforeToken = lineText.slice(0, match.index);
          const isEnvCallArg =
            /(?:pulse\.(?:getEnv|setEnv)|pulse\.(?:environment|variables)\.(?:get|set))\(\s*$/.test(
              prefixBeforeToken
            ) &&
            token.length >= 2 &&
            !token.includes('{{');
          if (isEnvCallArg) {
            const varKey = token.slice(1, -1).trim();
            const isResolved = Object.prototype.hasOwnProperty.call(envVars, varKey);
            parts.push(
              <span
                key={`${lineKey}_jsenv_${match.index}`}
                data-var-name={varKey}
                className={
                  isResolved
                    ? isDark
                      ? 'rounded-[3px] bg-emerald-500/20 text-emerald-300'
                      : 'rounded-[3px] bg-emerald-500/15 text-emerald-700'
                    : isDark
                      ? 'rounded-[3px] bg-amber-500/20 text-amber-300'
                      : 'rounded-[3px] bg-amber-500/20 text-amber-700'
                }
              >
                {token}
              </span>
            );
            lastIndex = jsRegex.lastIndex;
            continue;
          }
        } else if (token === 'pulse' || token === 'response') {
          color = isDark ? 'text-sky-400' : 'text-sky-700';
        } else if (/^(const|let|var|function|return|if|else|try|catch|new)$/.test(token)) {
          color = isDark ? 'text-violet-400' : 'text-violet-700';
        } else if (/^(true|false|null|undefined)$/.test(token)) {
          color = isDark ? 'text-purple-400' : 'text-purple-700';
        } else if (!isNaN(Number(token))) {
          color = isDark ? 'text-amber-400' : 'text-amber-700';
        } else if (/^[{}()\[\]]$/.test(token)) {
          color = isDark ? 'text-violet-300' : 'text-violet-700';
        }
        const rendered = renderEnvVarSpans(token, color, `${lineKey}_${match.index}`);
        parts.push(
          wrapWithMatchHighlight(rendered, lineStartOffset + match.index, token.length, `${lineKey}_m_${match.index}`)
        );
        lastIndex = jsRegex.lastIndex;
      }
      if (lastIndex < lineText.length) {
        parts.push(
          renderEnvVarSpans(
            lineText.slice(lastIndex),
            isDark ? 'text-slate-200' : 'text-slate-800',
            `${lineKey}_jstail`
          )
        );
      }
      return parts;
    }

    if (language === 'raw') {
      return renderEnvVarSpans(lineText, isDark ? 'text-slate-200' : 'text-slate-800', `${lineKey}_raw`);
    }

    // Default: JSON tokenizer with vibrant key/string/number/boolean/brace/envVar colors
    const tokenRegex = /(\{\{[^}]+\}\}|"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[{}\[\],:])/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(lineText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          renderEnvVarSpans(
            lineText.slice(lastIndex, match.index),
            isDark ? 'text-slate-300' : 'text-slate-700',
            `${lineKey}_jsonpre_${lastIndex}`
          )
        );
      }

      const token = match[0];
      if (token.startsWith('{{') && token.endsWith('}}')) {
        parts.push(
          renderEnvVarSpans(
            token,
            isDark ? 'text-slate-300' : 'text-slate-700',
            `${lineKey}_jsonev_${match.index}`
          )
        );
        lastIndex = tokenRegex.lastIndex;
        continue;
      }
      let color = isDark ? 'text-slate-300' : 'text-slate-700';

      if (/^"/.test(token)) {
        if (/:$/.test(token)) {
          // Separate key string vs trailing colon so braces/colons stand out cleanly
          const colonIdx = token.lastIndexOf(':');
          const keyPart = token.slice(0, colonIdx);
          const colonPart = token.slice(colonIdx);
          parts.push(
            renderEnvVarSpans(
              keyPart,
              isDark ? 'text-sky-400' : 'text-sky-700',
              `${lineKey}_k_${match.index}`
            )
          );
          parts.push(
            <span key={`${lineKey}_c_${match.index}`} className={isDark ? 'text-slate-400' : 'text-slate-500'}>
              {colonPart}
            </span>
          );
          lastIndex = tokenRegex.lastIndex;
          continue;
        } else {
          color = isDark ? 'text-emerald-400' : 'text-emerald-700';
        }
      } else if (/^(true|false)$/.test(token)) {
        color = isDark ? 'text-purple-400' : 'text-purple-700';
      } else if (/^null$/.test(token)) {
        color = isDark ? 'text-rose-400' : 'text-rose-600';
      } else if (!isNaN(Number(token))) {
        color = isDark ? 'text-amber-400' : 'text-amber-700';
      } else if (/^[{}[\]]$/.test(token)) {
        color = isDark ? 'text-violet-400' : 'text-violet-700';
      } else {
        color = isDark ? 'text-slate-400' : 'text-slate-600';
      }

      const rendered = renderEnvVarSpans(token, color, `${lineKey}_${match.index}`);
      parts.push(
        wrapWithMatchHighlight(rendered, lineStartOffset + match.index, token.length, `${lineKey}_m_${match.index}`)
      );

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < lineText.length) {
      parts.push(
        renderEnvVarSpans(
          lineText.slice(lastIndex),
          isDark ? 'text-slate-300' : 'text-slate-700',
          `${lineKey}_jsontail`
        )
      );
    }

    return parts;
  };

  const trigger = useMemo(() => {
    if (!isFocused || isAutocompleteDismissed) return null;
    return findEnvVarTrigger(value, cursorPos, varEntries, {
      allowBarePrefix: true,
      allowJsScriptKey: language === 'js',
    });
  }, [isFocused, isAutocompleteDismissed, value, cursorPos, varEntries, language]);

  const suggestions = useMemo(
    () => filterEnvVarSuggestions(trigger, varEntries),
    [trigger, varEntries]
  );

  useEffect(() => {
    setHighlightedIdx(0);
  }, [trigger?.query, trigger?.start]);

  const showDropdown = !!trigger && suggestions.length > 0;

  useEffect(() => {
    if (!showDropdown || !textareaRef.current) {
      setDropdownPos(null);
      return;
    }
    const rect = textareaRef.current.getBoundingClientRect();
    const before = value.slice(0, cursorPos);
    const linesBefore = before.split('\n');
    const row = linesBefore.length - 1;
    const col = linesBefore[linesBefore.length - 1].length;
    const rawTop = rect.top + 12 + (row + 1) * 20 - textareaRef.current.scrollTop + 4;
    const rawLeft = rect.left + 12 + col * 7.2 - textareaRef.current.scrollLeft;
    setDropdownPos({
      left: Math.max(12, Math.min(rawLeft, window.innerWidth - 310)),
      top: Math.max(rect.top + 24, Math.min(rawTop, window.innerHeight - 230)),
    });
  }, [showDropdown, value, cursorPos]);

  const insertSuggestedVar = (varName: string) => {
    if (!trigger) return;
    const { nextText, nextCursor } = applyEnvVarSuggestion(value, trigger, varName);
    onChange(nextText);
    setCursorPos(nextCursor);
    setIsAutocompleteDismissed(true);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCursor, nextCursor);
        syncScroll();
      }
    });
  };

  // Smart key handling: autocomplete navigation, Tab indent, auto-close {}, [], "", XML closing tag </tag>, smart Enter indent
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        (e.key === 'Enter' &&
          !e.metaKey &&
          !e.ctrlKey &&
          (trigger?.hasBraces || trigger?.mode === 'script-key'))
      ) {
        e.preventDefault();
        const picked = suggestions[highlightedIdx] || suggestions[0];
        if (picked) insertSuggestedVar(picked[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsAutocompleteDismissed(true);
        return;
      }
    }
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    const updateWithCaret = (nextVal: string, nextCaret: number) => {
      setIsAutocompleteDismissed(false);
      onChange(nextVal);
      setCursorPos(nextCaret);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = nextCaret;
          textareaRef.current.selectionEnd = nextCaret;
          syncScroll();
        }
      });
    };

    if (e.key === 'Tab') {
      e.preventDefault();
      const nextVal = value.slice(0, start) + '  ' + value.slice(end);
      updateWithCaret(nextVal, start + 2);
      return;
    }

    // Auto-close pairs for JSON / GraphQL / JS
    const pairs: Record<string, string> = { '{': '}', '[': ']', '"': '"' };
    if ((language === 'json' || language === 'graphql' || language === 'js') && pairs[e.key]) {
      const closeChar = pairs[e.key];
      const nextChar = value[end];
      // Skip duplicate closing quote if cursor is already before `"`
      if (e.key === '"' && nextChar === '"' && start === end) {
        e.preventDefault();
        updateWithCaret(value, start + 1);
        return;
      }
      e.preventDefault();
      const selected = value.slice(start, end);
      const nextVal = value.slice(0, start) + e.key + selected + closeChar + value.slice(end);
      updateWithCaret(nextVal, start + 1);
      return;
    }

    // Auto-close XML tags when typing `>` on `<tagName`
    if (language === 'xml' && e.key === '>' && start === end) {
      const before = value.slice(0, start);
      const openMatch = before.match(/<([a-zA-Z0-9_:\-]+)(?:\s+[^<>]*)?$/);
      if (openMatch && !before.endsWith('/')) {
        const tagName = openMatch[1];
        if (!tagName.startsWith('?') && !tagName.startsWith('!')) {
          e.preventDefault();
          const nextVal = before + `></${tagName}>` + value.slice(end);
          updateWithCaret(nextVal, start + 1);
          return;
        }
      }
    }

    // Smart Enter indentation (and newline expansion between `{}` or `<tag></tag>`)
    if (e.key === 'Enter' && start === end) {
      const before = value.slice(0, start);
      const after = value.slice(end);
      const currentLineStart = before.lastIndexOf('\n') + 1;
      const currentLine = before.slice(currentLineStart);
      const indentMatch = currentLine.match(/^(\s*)/);
      const baseIndent = indentMatch ? indentMatch[1] : '';

      const betweenBraces =
        (before.endsWith('{') && after.startsWith('}')) ||
        (before.endsWith('[') && after.startsWith(']'));
      const betweenXmlTags =
        language === 'xml' && before.endsWith('>') && after.startsWith('</');

      if (betweenBraces || betweenXmlTags) {
        e.preventDefault();
        const innerIndent = baseIndent + '  ';
        const nextVal = before + '\n' + innerIndent + '\n' + baseIndent + after;
        updateWithCaret(nextVal, start + 1 + innerIndent.length);
        return;
      }

      if (before.endsWith('{') || before.endsWith('[') || (language === 'xml' && /<[^/!?][^>]*>$/.test(before))) {
        e.preventDefault();
        const innerIndent = baseIndent + '  ';
        const nextVal = before + '\n' + innerIndent + after;
        updateWithCaret(nextVal, start + 1 + innerIndent.length);
        return;
      }

      if (baseIndent) {
        e.preventDefault();
        const nextVal = before + '\n' + baseIndent + after;
        updateWithCaret(nextVal, start + 1 + baseIndent.length);
      }
    }
  };

  // Precompute line character offsets for brace pair lookup
  const lineOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const l of lines) {
      offsets.push(acc);
      acc += l.length + 1;
    }
    return offsets;
  }, [lines]);

  // Render interactive folded view when user collapses one or more blocks
  const renderFoldedLines = () => {
    const rows: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const block = blockByStartLine.get(i);
      const isCollapsed = block && collapsedLines.has(i);

      if (block && isCollapsed) {
        rows.push(
          <div key={i} className="flex h-5 leading-5 items-center">
            <button
              type="button"
              onClick={() => toggleFold(block.startLine)}
              className={`w-12 pr-2 text-right select-none flex items-center justify-end gap-1 cursor-pointer shrink-0 ${
                isDark ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-900'
              }`}
              title={`Expand ${block.lineCount} lines`}
            >
              <span className="text-[11px] font-mono">{i + 1}</span>
              <span className="text-[10px] text-violet-400">▸</span>
            </button>
            <div className="pl-2 whitespace-pre font-mono text-xs flex items-center gap-1.5">
              {block.prefix && <span>{renderLineTokens(block.prefix, lineOffsets[i], i)}</span>}
              <button
                type="button"
                onClick={() => toggleFold(block.startLine)}
                className={`inline-flex items-center gap-1 px-1.5 rounded border text-[11px] cursor-pointer ${
                  isDark
                    ? 'bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/30'
                    : 'bg-violet-100 text-violet-800 border-violet-300 hover:bg-violet-200'
                }`}
              >
                <span>{block.openLabel}</span>
                <span className="text-[10px] opacity-80">⤹ {block.lineCount}</span>
                <span>{block.closeLabel}</span>
              </button>
              {block.trailingComma && (
                <span className={isDark ? 'text-slate-400' : 'text-slate-600'}>,</span>
              )}
            </div>
          </div>
        );
        i = block.endLine + 1;
        continue;
      }

      rows.push(
        <div key={i} className="flex h-5 leading-5 items-center">
          <div
            onClick={() => block && toggleFold(block.startLine)}
            className={`w-12 pr-2 text-right select-none flex items-center justify-end gap-1 shrink-0 ${
              block ? 'cursor-pointer' : ''
            } ${isDark ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`}
          >
            <span className="text-[11px] font-mono">{i + 1}</span>
            <span className="w-2.5 text-[10px] text-slate-400">{block ? '▾' : ''}</span>
          </div>
          <div className="pl-2 whitespace-pre font-mono text-xs">
            {renderLineTokens(lines[i], lineOffsets[i], i)}
          </div>
        </div>
      );
      i++;
    }
    return rows;
  };

  return (
    <div
      className={`relative flex flex-col flex-1 ${minHeightClass} rounded-xl border overflow-hidden transition ${
        isDark
          ? 'border-neutral-800 bg-[#161924] focus-within:border-violet-500'
          : 'border-slate-300 bg-white focus-within:border-violet-500 shadow-2xs'
      }`}
    >
      {/* Subtle Mini Fold Bar when foldable blocks exist */}
      {foldableBlocks.length > 0 && (
        <div
          className={`flex items-center justify-between px-3 py-1 border-b text-[10px] select-none shrink-0 ${
            isDark ? 'border-neutral-800/80 bg-[#11131a] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          <span className="font-mono">
            {lines.length} lines • {foldableBlocks.length} foldable {language === 'xml' ? 'tags' : 'blocks'}
          </span>
          <div className="flex items-center gap-2 font-semibold">
            {isFoldedView ? (
              <button
                type="button"
                onClick={() => setCollapsedLines(new Set())}
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  isDark ? 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30' : 'bg-violet-100 text-violet-800 hover:bg-violet-200'
                }`}
              >
                Expand All (Edit)
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const nested = new Set<number>();
                  foldableBlocks.forEach((b) => {
                    if (b.startLine > 0) nested.add(b.startLine);
                  });
                  if (nested.size === 0 && foldableBlocks[0]) nested.add(foldableBlocks[0].startLine);
                  setCollapsedLines(nested);
                }}
                className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                  isDark ? 'hover:bg-neutral-800 text-slate-300' : 'hover:bg-slate-200 text-slate-700'
                }`}
              >
                Collapse Blocks
              </button>
            )}
          </div>
        </div>
      )}

      {isFoldedView ? (
        <div
          className="flex-1 overflow-auto p-2 cursor-text"
          onDoubleClick={() => setCollapsedLines(new Set())}
          title="Click ▸ arrows to expand, or click Expand All to edit"
        >
          {renderFoldedLines()}
        </div>
      ) : (
        <div className="relative flex flex-1 min-h-0 overflow-hidden">
          {/* Line Numbers + Fold Arrow Gutter */}
          <div
            ref={gutterRef}
            aria-hidden="true"
            className={`w-12 shrink-0 overflow-hidden border-r py-3 select-none font-mono text-[11px] ${
              isDark
                ? 'border-neutral-800/80 bg-[#12151e] text-slate-500'
                : 'border-slate-200 bg-slate-50 text-slate-400'
            }`}
          >
            {lines.map((_, idx) => {
              const block = blockByStartLine.get(idx);
              return (
                <div
                  key={idx}
                  onClick={() => block && toggleFold(block.startLine)}
                  className={`h-5 leading-5 pr-2 flex items-center justify-end gap-1 ${
                    block ? 'cursor-pointer hover:text-violet-400' : ''
                  }`}
                >
                  <span>{idx + 1}</span>
                  <span className="w-2.5 text-[10px] text-center">{block ? '▾' : ''}</span>
                </div>
              );
            })}
          </div>

          {/* Code Mirror + Transparent Textarea Overlay */}
          <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
            <pre
              ref={mirrorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-0 p-3 overflow-hidden font-mono text-xs leading-5 font-normal tracking-normal whitespace-pre"
            >
              {value ? (
                lines.map((lineText, idx) => (
                  <div key={idx} className="h-5 leading-5">
                    {renderLineTokens(lineText, lineOffsets[idx], idx)}
                  </div>
                ))
              ) : (
                <span className={isDark ? 'text-slate-600' : 'text-slate-400'}>{placeholder}</span>
              )}
            </pre>

            <textarea
              ref={textareaRef}
              value={value}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
              onFocus={(e) => {
                setIsFocused(true);
                setIsAutocompleteDismissed(false);
                setCursorPos(e.currentTarget.selectionStart);
              }}
              onBlur={() => {
                setIsFocused(false);
                setIsAutocompleteDismissed(true);
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
                  if (
                    e.clientX >= r.left &&
                    e.clientX <= r.right &&
                    e.clientY >= r.top &&
                    e.clientY <= r.bottom
                  ) {
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
              onClick={(e) => {
                setCursorPos(e.currentTarget.selectionStart);
                setIsAutocompleteDismissed(false);
              }}
              onKeyUp={(e) => setCursorPos(e.currentTarget.selectionStart)}
              onKeyDown={handleKeyDown}
              onChange={(e) => {
                setIsAutocompleteDismissed(false);
                setCursorPos(e.target.selectionStart);
                onChange(e.target.value);
                requestAnimationFrame(syncScroll);
              }}
              className={`relative z-10 h-full w-full resize-none overflow-auto bg-transparent p-3 font-mono text-xs leading-5 font-normal tracking-normal select-text focus:outline-none text-transparent ${
                isDark ? 'caret-white' : 'caret-slate-900'
              }`}
            />

            {/* Environment Variables Autocomplete Dropdown */}
            {showDropdown && dropdownPos && (
              <EnvVarDropdown
                suggestions={suggestions}
                highlightedIdx={highlightedIdx}
                onHighlight={setHighlightedIdx}
                onSelect={insertSuggestedVar}
                envName={activeEnv?.name}
                triggerMode={trigger?.mode}
                isDark={isDark}
                style={{
                  position: 'fixed',
                  left: dropdownPos.left,
                  top: dropdownPos.top,
                  width: 300,
                }}
              />
            )}

            {/* Hover Tooltip for {{variable}} or pulse.getEnv("variable") */}
            {hoveredVar && !showDropdown && (
              <EnvVarTooltip
                hoveredVar={hoveredVar}
                envName={activeEnv?.name}
                isDark={isDark}
                positionMode="fixed"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

CodeInputEditor.displayName = 'CodeInputEditor';
