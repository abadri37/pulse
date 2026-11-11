import React, { useState, useMemo } from 'react';

interface Props {
  rawJson: string;
  isDark?: boolean;
  filterPath?: string;
  onFilterChange?: (path: string) => void;
}

interface FoldableBlock {
  startLine: number; // 0-based
  endLine: number;   // 0-based
  lineCount: number;
  openChar: string;
  closeChar: string;
  prefix: string;
  trailingComma: boolean;
}

// XML Formatter
const formatXml = (xml: string): string => {
  if (!xml.trim()) return xml;
  let formatted = '';
  let pad = 0;
  const reg = /(>)(<)(\/*)/g;
  const lines = xml.replace(reg, '$1\r\n$2$3').split('\r\n');
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.match(/^<\/\w/)) {
      if (pad > 0) pad--;
    }
    formatted += '  '.repeat(pad) + trimmed + '\n';
    if (
      trimmed.match(/^<\w[^>]*[^\/]>.*$/) &&
      !trimmed.match(/<\/\w+>$/) &&
      !trimmed.startsWith('<?') &&
      !trimmed.startsWith('<!')
    ) {
      pad++;
    }
  });
  return formatted.trim();
};

export const CodeEditor: React.FC<Props> = ({
  rawJson,
  isDark = true,
  filterPath = '',
}) => {
  const [collapsedLineStarts, setCollapsedLineStarts] = useState<Set<number>>(new Set());

  // Check if content is XML / SOAP
  const isXml = useMemo(() => {
    return rawJson.trim().startsWith('<');
  }, [rawJson]);

  // Parse JSON/XML and optionally evaluate JSONPath / filter
  const { formattedText, error } = useMemo(() => {
    if (!rawJson.trim()) return { formattedText: '', error: null };

    if (isXml) {
      try {
        const beautified = formatXml(rawJson.trim());
        return { formattedText: beautified, error: null };
      } catch (e: any) {
        return { formattedText: rawJson, error: null };
      }
    }

    try {
      let parsed = JSON.parse(rawJson);

      // If user typed a filter path like "$.entries" or "entries[0]"
      if (filterPath.trim()) {
        const cleanPath = filterPath.replace(/^\$\.?/, '').trim();
        if (cleanPath) {
          const parts = cleanPath.split(/[.\[\]]/).filter(Boolean);
          let current = parsed;
          for (const p of parts) {
            if (current && typeof current === 'object' && p in current) {
              current = current[p];
            } else {
              break;
            }
          }
          if (current !== undefined) {
            parsed = current;
          }
        }
      }

      return {
        formattedText: JSON.stringify(parsed, null, 2),
        error: null,
      };
    } catch (e: any) {
      return {
        formattedText: rawJson,
        error: e?.message || 'Invalid format',
      };
    }
  }, [rawJson, filterPath, isXml]);

  // Split formatted content into individual lines
  const rawLines = useMemo(() => {
    if (!formattedText) return [];
    return formattedText.split('\n');
  }, [formattedText]);

  // Scan lines to identify all foldable blocks (JSON { ... } / [ ... ] or XML <tag> ... </tag>)
  const foldableBlocks = useMemo(() => {
    const blocks: FoldableBlock[] = [];

    if (isXml) {
      // XML Tag Block Stacking
      const stack: { lineIdx: number; tagName: string; fullOpen: string }[] = [];
      const openTagRegex = /^<([a-zA-Z0-9_:\-]+)(?:\s+[^>]*)?>$/;
      const closeTagRegex = /^<\/([a-zA-Z0-9_:\-]+)>$/;

      rawLines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('<?') || trimmed.startsWith('<!--') || trimmed.endsWith('/>')) {
          return;
        }

        const openMatch = trimmed.match(openTagRegex);
        if (openMatch && !trimmed.includes(`</${openMatch[1]}>`)) {
          stack.push({ lineIdx: idx, tagName: openMatch[1], fullOpen: trimmed });
          return;
        }

        const closeMatch = trimmed.match(closeTagRegex);
        if (closeMatch && stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top.tagName === closeMatch[1]) {
            stack.pop();
            const linesFolded = idx - top.lineIdx;
            if (linesFolded > 0) {
              blocks.push({
                startLine: top.lineIdx,
                endLine: idx,
                lineCount: linesFolded,
                openChar: `<${top.tagName}>`,
                closeChar: `</${closeMatch[1]}>`,
                prefix: '',
                trailingComma: false,
              });
            }
          }
        }
      });
    } else {
      // JSON Block Stacking
      const stack: { lineIdx: number; char: '{' | '[' }[] = [];
      rawLines.forEach((line, idx) => {
        const trimmed = line.trim();
        const endsWithOpenBrace = /[{\[]$/.test(trimmed);
        const startsWithCloseBrace = /^[}\]]/.test(trimmed);

        if (endsWithOpenBrace) {
          const openChar = trimmed.endsWith('{') ? '{' : '[';
          stack.push({ lineIdx: idx, char: openChar });
        }

        if (startsWithCloseBrace && stack.length > 0) {
          const openItem = stack.pop();
          if (
            openItem &&
            ((openItem.char === '{' && trimmed.startsWith('}')) ||
              (openItem.char === '[' && trimmed.startsWith(']')))
          ) {
            const linesFolded = idx - openItem.lineIdx;
            if (linesFolded > 0) {
              const firstLine = rawLines[openItem.lineIdx];
              const prefix = firstLine.substring(0, firstLine.lastIndexOf(openItem.char));
              const hasTrailingComma = trimmed.endsWith(',');

              blocks.push({
                startLine: openItem.lineIdx,
                endLine: idx,
                lineCount: linesFolded,
                openChar: openItem.char,
                closeChar: openItem.char === '{' ? '}' : ']',
                prefix,
                trailingComma: hasTrailingComma,
              });
            }
          }
        }
      });
    }

    return blocks;
  }, [rawLines, isXml]);

  // Lookup map: startLine -> FoldableBlock
  const blockByStartLine = useMemo(() => {
    const map = new Map<number, FoldableBlock>();
    foldableBlocks.forEach((b) => map.set(b.startLine, b));
    return map;
  }, [foldableBlocks]);

  const toggleFold = (startLine: number) => {
    setCollapsedLineStarts((prev) => {
      const next = new Set(prev);
      if (next.has(startLine)) {
        next.delete(startLine);
      } else {
        next.add(startLine);
      }
      return next;
    });
  };

  const expandAll = () => {
    setCollapsedLineStarts(new Set());
  };

  const collapseAll = () => {
    const all = new Set<number>();
    foldableBlocks.forEach((b) => {
      if (b.startLine > 0) all.add(b.startLine);
    });
    setCollapsedLineStarts(all);
  };

  // Syntax Tokenizer for a line
  const renderTokens = (lineText: string) => {
    if (isXml) {
      // XML Tokenizer
      const xmlRegex = /(<!--[\s\S]*?-->|<\?[^>]*\?>|<\/?[a-zA-Z0-9_:\-]+|\/?>|"[^"]*"|'[^']*'|[a-zA-Z0-9_:\-]+(?=\s*=)|=\s*|[^<>\s]+|\s+)/g;
      const parts: React.ReactNode[] = [];
      let match;

      while ((match = xmlRegex.exec(lineText)) !== null) {
        const token = match[0];
        let colorClass = isDark ? 'text-slate-200' : 'text-slate-800';

        if (token.startsWith('<!--')) {
          colorClass = isDark ? 'text-slate-500 italic' : 'text-slate-400 italic';
        } else if (token.startsWith('<?')) {
          colorClass = isDark ? 'text-purple-400 italic font-mono' : 'text-purple-600 italic font-mono';
        } else if (token.startsWith('<')) {
          colorClass = isDark ? 'text-[#38bdf8] font-bold' : 'text-[#0284c7] font-bold';
        } else if (token === '>' || token === '/>') {
          colorClass = isDark ? 'text-[#38bdf8] font-bold' : 'text-[#0284c7] font-bold';
        } else if (token.startsWith('"') || token.startsWith("'")) {
          colorClass = isDark ? 'text-[#34d399]' : 'text-[#059669]';
        } else if (/^[a-zA-Z0-9_:\-]+$/.test(token)) {
          colorClass = isDark ? 'text-[#fbbf24] font-medium' : 'text-[#d97706] font-medium';
        }

        parts.push(
          <span key={match.index} className={colorClass}>
            {token}
          </span>
        );
      }

      return parts;
    }

    // JSON Tokenizer
    const tokenRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|[{}\[\],:])/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(lineText)) !== null) {
      if (match.index > lastIndex) {
        parts.push(lineText.substring(lastIndex, match.index));
      }

      const token = match[0];
      let colorClass = isDark ? 'text-slate-300' : 'text-slate-700';

      if (/^"/.test(token)) {
        if (/:$/.test(token)) {
          colorClass = isDark ? 'text-[#38bdf8] font-bold' : 'text-[#0284c7] font-bold';
        } else {
          colorClass = isDark ? 'text-[#34d399]' : 'text-[#059669]';
        }
      } else if (/true|false/.test(token)) {
        colorClass = isDark ? 'text-[#c084fc] font-bold' : 'text-[#9333ea] font-bold';
      } else if (/null/.test(token)) {
        colorClass = isDark ? 'text-[#f87171] font-semibold italic' : 'text-[#dc2626] font-semibold italic';
      } else if (!isNaN(Number(token))) {
        colorClass = isDark ? 'text-[#fbbf24] font-bold' : 'text-[#d97706] font-bold';
      } else {
        colorClass = isDark ? 'text-slate-400 font-bold' : 'text-slate-600 font-bold';
      }

      parts.push(
        <span key={match.index} className={colorClass}>
          {token}
        </span>
      );

      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < lineText.length) {
      parts.push(lineText.substring(lastIndex));
    }

    return parts;
  };

  // Build rendered line list taking collapsed blocks into account
  const renderedLines: React.ReactNode[] = [];
  let lineIdx = 0;

  while (lineIdx < rawLines.length) {
    const currentLineNum = lineIdx + 1;
    const block = blockByStartLine.get(lineIdx);
    const isCollapsed = block && collapsedLineStarts.has(lineIdx);

    if (block) {
      if (isCollapsed) {
        renderedLines.push(
          <div
            key={lineIdx}
            className={`flex h-5 leading-5 items-center select-text hover:bg-white/5 transition-colors group ${
              isDark ? 'text-slate-200' : 'text-slate-800'
            }`}
          >
            <div
              onClick={() => toggleFold(block.startLine)}
              className={`w-12 pr-2 text-right select-none flex items-center justify-end gap-1 cursor-pointer shrink-0 ${
                isDark ? 'text-slate-600 hover:text-white' : 'text-slate-400 hover:text-slate-900'
              }`}
            >
              <span className="text-[11px] font-mono">{currentLineNum}</span>
              <span className="text-[10px] text-violet-400 font-black">▸</span>
            </div>

            <div className="pl-2 whitespace-pre font-mono text-xs flex items-center gap-1.5">
              {block.prefix && <span>{renderTokens(block.prefix)}</span>}
              <span
                onClick={() => toggleFold(block.startLine)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-violet-600/20 text-violet-300 hover:bg-violet-600/35 border border-violet-500/30 cursor-pointer font-bold select-none text-[11px]"
                title={`Click to expand ${block.lineCount} folded lines`}
              >
                <span>{block.openChar}</span>
                <span className="text-[10px] opacity-80">⤹ {block.lineCount}</span>
                <span>{block.closeChar}</span>
              </span>
              {block.trailingComma && <span className="text-slate-400 font-bold">,</span>}
            </div>
          </div>
        );
        lineIdx = block.endLine + 1;
        continue;
      } else {
        renderedLines.push(
          <div
            key={lineIdx}
            className={`flex h-5 leading-5 items-center select-text hover:bg-white/5 transition-colors group ${
              isDark ? 'text-slate-200' : 'text-slate-800'
            }`}
          >
            <div
              onClick={() => toggleFold(block.startLine)}
              className={`w-12 pr-2 text-right select-none flex items-center justify-end gap-1 cursor-pointer shrink-0 ${
                isDark ? 'text-slate-600 hover:text-white' : 'text-slate-400 hover:text-slate-900'
              }`}
            >
              <span className="text-[11px] font-mono">{currentLineNum}</span>
              <span className="text-[10px] text-slate-400 font-black group-hover:text-violet-400">▾</span>
            </div>

            <div className="pl-2 whitespace-pre font-mono text-xs">
              {renderTokens(rawLines[lineIdx])}
            </div>
          </div>
        );
      }
    } else {
      renderedLines.push(
        <div
          key={lineIdx}
          className={`flex h-5 leading-5 items-center select-text hover:bg-white/5 transition-colors ${
            isDark ? 'text-slate-200' : 'text-slate-800'
          }`}
        >
          <div className={`w-12 pr-2 text-right select-none flex items-center justify-end shrink-0 ${
            isDark ? 'text-slate-600' : 'text-slate-400'
          }`}>
            <span className="text-[11px] font-mono">{currentLineNum}</span>
            <span className="w-2.5" />
          </div>

          <div className="pl-2 whitespace-pre font-mono text-xs">
            {renderTokens(rawLines[lineIdx])}
          </div>
        </div>
      );
    }

    lineIdx++;
  }

  return (
    <div className={`flex flex-col h-full font-mono text-xs overflow-hidden ${
      isDark ? 'bg-[#13161f] text-slate-200' : 'bg-white text-slate-800'
    }`}>
      {/* Sub-Toolbar: Format Info & Expand All / Collapse All */}
      <div className={`flex items-center justify-between border-b px-3 py-1.5 text-xs select-none ${
        isDark ? 'border-neutral-800/80 bg-[#161924]' : 'border-slate-200 bg-slate-50'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            {isXml ? 'XML / SOAP' : 'JSON'} • {rawLines.length} lines • {foldableBlocks.length} collapsible blocks
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={expandAll}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
              isDark ? 'text-slate-300 hover:bg-neutral-800 hover:text-white' : 'text-slate-700 hover:bg-slate-200'
            }`}
          >
            Expand All
          </button>
          <span className="text-slate-600">•</span>
          <button
            onClick={collapseAll}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
              isDark ? 'text-slate-300 hover:bg-neutral-800 hover:text-white' : 'text-slate-700 hover:bg-slate-200'
            }`}
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-auto p-2">
        {renderedLines}
      </div>
    </div>
  );
};
