import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  ListTree,
  Code2,
} from 'lucide-react';

interface Props {
  rawJson: string;
  searchTerm?: string;
  isDark?: boolean;
}

export const JSONTreeViewer: React.FC<Props> = ({ rawJson, searchTerm = '', isDark = true }) => {
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // Parse JSON
  const parsedData = useMemo(() => {
    try {
      return { valid: true, data: JSON.parse(rawJson) };
    } catch (e: any) {
      return { valid: false, error: e.message, data: null };
    }
  }, [rawJson]);

  // Collect all expandable paths in the object
  const allExpandablePaths = useMemo(() => {
    if (!parsedData.valid) return [];
    const paths: string[] = [];
    const traverse = (val: any, currentPath: string) => {
      if (val !== null && typeof val === 'object') {
        paths.push(currentPath);
        if (Array.isArray(val)) {
          val.forEach((item, idx) => traverse(item, `${currentPath}[${idx}]`));
        } else {
          Object.entries(val).forEach(([k, v]) => traverse(v, currentPath ? `${currentPath}.${k}` : k));
        }
      }
    };
    traverse(parsedData.data, 'root');
    return paths;
  }, [parsedData]);

  // Automatically expand nodes if searchTerm is entered
  useEffect(() => {
    if (!searchTerm.trim() || !parsedData.valid) return;
    const lowerSearch = searchTerm.toLowerCase();
    const shouldExpandPaths: Record<string, boolean> = {};

    const findMatches = (val: any, currentPath: string): boolean => {
      let hasChildMatch = false;
      if (val !== null && typeof val === 'object') {
        if (Array.isArray(val)) {
          val.forEach((item, idx) => {
            const match = findMatches(item, `${currentPath}[${idx}]`);
            if (match) hasChildMatch = true;
          });
        } else {
          Object.entries(val).forEach(([k, v]) => {
            if (k.toLowerCase().includes(lowerSearch)) hasChildMatch = true;
            const match = findMatches(v, currentPath ? `${currentPath}.${k}` : k);
            if (match) hasChildMatch = true;
          });
        }
        if (hasChildMatch) {
          shouldExpandPaths[currentPath] = false; // false means NOT collapsed (expanded)
        }
      } else {
        if (String(val).toLowerCase().includes(lowerSearch)) {
          return true;
        }
      }
      return hasChildMatch;
    };

    findMatches(parsedData.data, 'root');
    setCollapsedPaths((prev) => ({ ...prev, ...shouldExpandPaths }));
  }, [searchTerm, parsedData]);

  const expandAll = () => {
    setCollapsedPaths({});
  };

  const collapseAll = () => {
    const collapsed: Record<string, boolean> = {};
    allExpandablePaths.forEach((p) => {
      if (p !== 'root') {
        collapsed[p] = true;
      }
    });
    setCollapsedPaths(collapsed);
  };

  const collapseToDepth = (targetDepth: number) => {
    const collapsed: Record<string, boolean> = {};
    allExpandablePaths.forEach((p) => {
      // Approximate depth by splitting on dots and brackets
      const segments = p.split(/[.\[]/).filter(Boolean);
      if (segments.length > targetDepth) {
        collapsed[p] = true;
      }
    });
    setCollapsedPaths(collapsed);
  };

  const togglePath = useCallback((path: string) => {
    setCollapsedPaths((prev) => ({
      ...prev,
      [path]: !prev[path],
    }));
  }, []);

  const copyPath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cleanPath = path.replace(/^root\./, '').replace(/^root/, '');
    navigator.clipboard.writeText(cleanPath || 'response');
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  // Helper to highlight matching text
  const highlightText = (text: string, isStringValue = false) => {
    if (!searchTerm.trim()) {
      return isStringValue ? `"${text}"` : text;
    }
    const lowerText = text.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    const index = lowerText.indexOf(lowerSearch);
    if (index === -1) {
      return isStringValue ? `"${text}"` : text;
    }

    const before = text.substring(0, index);
    const match = text.substring(index, index + searchTerm.length);
    const after = text.substring(index + searchTerm.length);

    return (
      <>
        {isStringValue && '"'}
        {before}
        <mark className="search-highlight font-semibold">{match}</mark>
        {after}
        {isStringValue && '"'}
      </>
    );
  };

  // Render a JSON Node (Object, Array, or Primitive)
  const renderNode = (keyName: string | number | null, value: any, currentPath: string, isLast = true): React.ReactNode => {
    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);
    const isCollapsed = !!collapsedPaths[currentPath];

    if (isObject) {
      const keys = Object.keys(value);
      const itemCount = keys.length;
      const openBracket = isArray ? '[' : '{';
      const closeBracket = isArray ? ']' : '}';

      return (
        <div key={currentPath} className="flex flex-col text-xs font-mono leading-relaxed group/node">
          {/* Node Header Row */}
          <div
            onClick={() => togglePath(currentPath)}
            className={`flex items-center gap-1.5 py-0.5 px-1.5 rounded-md cursor-pointer transition select-none ${
              isDark ? 'hover:bg-neutral-800/60' : 'hover:bg-indigo-50/80'
            }`}
          >
            {/* Collapse / Expand Caret */}
            <span
              className={`p-0.5 rounded transition ${
                isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-indigo-600'
              }`}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 text-neutral-400 transition-transform" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform" />
              )}
            </span>

            {/* Key Name (if inside object or array index) */}
            {keyName !== null && (
              <span className={`font-semibold ${
                typeof keyName === 'number'
                  ? isDark ? 'text-neutral-500' : 'text-neutral-400'
                  : isDark ? 'text-indigo-300' : 'text-indigo-700'
              }`}>
                {typeof keyName === 'number' ? `[${keyName}]` : highlightText(String(keyName))}:
              </span>
            )}

            {/* Brackets or Collapsed Pill */}
            {isCollapsed ? (
              <div className="flex items-center gap-1.5">
                <span className={isDark ? 'text-neutral-400' : 'text-neutral-600'}>{openBracket}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shadow-xs ${
                  isDark
                    ? 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:border-neutral-600'
                    : 'border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400'
                }`}>
                  {isArray ? `${itemCount} items` : `${itemCount} keys`}
                </span>
                <span className={isDark ? 'text-neutral-400' : 'text-neutral-600'}>{closeBracket}</span>
                {!isLast && <span className="text-neutral-500">,</span>}
              </div>
            ) : (
              <span className={`font-bold ${isDark ? 'text-neutral-400' : 'text-slate-600'}`}>
                {openBracket}
              </span>
            )}

            {/* Hover Actions: Copy Path */}
            <button
              onClick={(e) => copyPath(currentPath, e)}
              className="opacity-0 group-hover/node:opacity-100 ml-2 flex items-center gap-1 text-[10px] font-sans px-1.5 py-0.5 rounded text-neutral-400 hover:text-white bg-neutral-800/80 transition"
              title="Copy JSON Path"
            >
              {copiedPath === currentPath ? (
                <>
                  <Check className="h-2.5 w-2.5 text-emerald-400" />
                  <span className="text-emerald-400">Path Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-2.5 w-2.5" />
                  <span>Copy Path</span>
                </>
              )}
            </button>
          </div>

          {/* Children Items (when expanded) */}
          {!isCollapsed && (
            <div className={`ml-4.5 pl-3 border-l flex flex-col transition-colors ${
              isDark ? 'border-neutral-800 hover:border-neutral-700' : 'border-slate-200 hover:border-indigo-300'
            }`}>
              {isArray
                ? value.map((item: any, idx: number) =>
                    renderNode(idx, item, `${currentPath}[${idx}]`, idx === itemCount - 1)
                  )
                : keys.map((k, idx) =>
                    renderNode(k, value[k], currentPath ? `${currentPath}.${k}` : k, idx === itemCount - 1)
                  )}
              {/* Closing Bracket */}
              <div className="py-0.5 text-xs select-none">
                <span className={`font-bold ${isDark ? 'text-neutral-400' : 'text-slate-600'}`}>
                  {closeBracket}
                </span>
                {!isLast && <span className="text-neutral-500">,</span>}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Primitive Node (string, number, boolean, null)
    let valNode: React.ReactNode = null;
    let typeClass = '';

    if (typeof value === 'string') {
      typeClass = isDark ? 'text-emerald-400 font-medium' : 'text-emerald-700 font-semibold';
      valNode = highlightText(value, true);
    } else if (typeof value === 'number') {
      typeClass = isDark ? 'text-amber-400 font-semibold' : 'text-amber-700 font-bold';
      valNode = highlightText(String(value));
    } else if (typeof value === 'boolean') {
      typeClass = isDark ? 'text-purple-400 font-bold' : 'text-purple-700 font-bold';
      valNode = String(value);
    } else if (value === null) {
      typeClass = isDark ? 'text-rose-400 italic' : 'text-rose-600 italic font-semibold';
      valNode = 'null';
    }

    return (
      <div
        key={currentPath}
        className={`group/leaf flex items-center gap-1.5 py-0.5 px-2 rounded-md transition select-text ${
          isDark ? 'hover:bg-neutral-800/40' : 'hover:bg-indigo-50/60'
        }`}
      >
        <span className="w-4 shrink-0" /> {/* Spacer aligning with caret */}

        {/* Key */}
        {keyName !== null && (
          <span className={`font-semibold shrink-0 select-text ${
            typeof keyName === 'number'
              ? isDark ? 'text-neutral-500' : 'text-neutral-400'
              : isDark ? 'text-indigo-300' : 'text-indigo-700'
          }`}>
            {typeof keyName === 'number' ? `[${keyName}]` : highlightText(String(keyName))}:
          </span>
        )}

        {/* Value */}
        <span className={`break-all select-text ${typeClass}`}>
          {valNode}
        </span>
        {!isLast && <span className="text-neutral-500 select-none">,</span>}

        {/* Copy Path Helper on Hover */}
        <button
          onClick={(e) => copyPath(currentPath, e)}
          className="opacity-0 group-hover/leaf:opacity-100 ml-2 text-[10px] text-neutral-500 hover:text-neutral-300 transition"
          title="Copy JSON Path"
        >
          <Copy className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  };

  if (!parsedData.valid) {
    return (
      <div className={`p-4 text-xs font-mono select-text ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
        <div className="font-bold mb-2">Invalid JSON response payload:</div>
        <pre className="whitespace-pre-wrap">{rawJson || '(Empty body)'}</pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Interactive Toolbar for Tags: Expand All, Collapse All, Depth Selector */}
      <div className={`flex items-center justify-between border-b px-3 py-2 text-xs select-none ${
        isDark ? 'border-neutral-800 bg-neutral-900/60' : 'border-slate-200 bg-slate-100/80'
      }`}>
        <div className="flex items-center gap-2">
          <ListTree className="h-3.5 w-3.5 text-indigo-400" />
          <span className={`font-bold ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
            Interactive JSON Tree
          </span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full border ${
            isDark ? 'border-neutral-700 bg-neutral-800 text-neutral-400' : 'border-slate-300 bg-white text-neutral-600'
          }`}>
            Click tags to expand / close
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={expandAll}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              isDark
                ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white'
                : 'border-slate-300 bg-white text-neutral-700 hover:bg-slate-100'
            }`}
            title="Expand all nodes"
          >
            <Maximize2 className="h-3 w-3 text-emerald-400" />
            <span>Expand All</span>
          </button>

          <button
            onClick={collapseAll}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              isDark
                ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700 hover:text-white'
                : 'border-slate-300 bg-white text-neutral-700 hover:bg-slate-100'
            }`}
            title="Collapse all nodes"
          >
            <Minimize2 className="h-3 w-3 text-amber-400" />
            <span>Collapse All</span>
          </button>

          <div className="h-3.5 w-[1px] bg-neutral-700/60 mx-1" />

          {/* Quick Depth Collapse */}
          <button
            onClick={() => collapseToDepth(1)}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              isDark
                ? 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                : 'border-slate-300 bg-white text-neutral-700 hover:bg-slate-100'
            }`}
            title="Collapse to Level 1"
          >
            Level 1
          </button>

          <button
            onClick={() => collapseToDepth(2)}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
              isDark
                ? 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white'
                : 'border-slate-300 bg-white text-neutral-700 hover:bg-slate-100'
            }`}
            title="Collapse to Level 2"
          >
            Level 2
          </button>
        </div>
      </div>

      {/* Tree Content Area */}
      <div className="flex-1 overflow-auto p-4 select-text">
        {renderNode(null, parsedData.data, 'root', true)}
      </div>
    </div>
  );
};
