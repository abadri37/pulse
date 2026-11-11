import React, { useState, useMemo } from 'react';
import { engine } from '../../wailsjs/go/models';
import { CodeEditor } from './CodeEditor';
import { JSONTreeViewer } from './JSONTreeViewer';
import { useTheme } from '../context/ThemeContext';
import {
  Copy,
  Check,
  Clock,
  Database,
  Globe,
  Cookie,
  CheckCircle2,
  XCircle,
  Search,
  Download,
  ListTree,
  Code2,
  FileText,
  Eye,
  Layers,
  Sparkles,
  Zap,
  HelpCircle,
  Filter,
} from 'lucide-react';

interface Props {
  response: engine.HTTPResponse | null;
  isLoading: boolean;
}

export const ResponseViewer: React.FC<Props> = ({ response, isLoading }) => {
  const { isDark, accentDef } = useTheme();
  const [activeTab, setActiveTab] = useState<'editor' | 'tree' | 'raw' | 'preview' | 'headers' | 'cookies' | 'tests' | 'timeline'>('editor');
  const [copied, setCopied] = useState(false);
  const [jsonPathQuery, setJsonPathQuery] = useState('');
  const [headerFilter, setHeaderFilter] = useState('');

  const copyToClipboard = () => {
    if (!response?.body) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadResponse = () => {
    if (!response?.body) return;
    const isJson = isResponseJson;
    const blob = new Blob([response.body], { type: isJson ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isJson ? `response_${Date.now()}.json` : `response_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const isResponseJson = useMemo(() => {
    if (!response?.body) return false;
    try {
      JSON.parse(response.body);
      return true;
    } catch {
      return false;
    }
  }, [response?.body]);

  const getStatusBadge = (status: number) => {
    if (status >= 200 && status < 300) {
      return {
        bg: 'bg-[#10b981] text-white font-black',
        label: `${status} OK`,
      };
    }
    if (status >= 300 && status < 400) {
      return {
        bg: 'bg-[#0ea5e9] text-white font-black',
        label: `${status} REDIRECT`,
      };
    }
    if (status >= 400 && status < 500) {
      return {
        bg: 'bg-[#f59e0b] text-white font-black',
        label: `${status} ERROR`,
      };
    }
    return {
      bg: 'bg-[#f43f5e] text-white font-black',
      label: `${status} SERVER ERROR`,
    };
  };

  const testCount = response?.testResults?.length || 0;
  const passedCount = response?.testResults?.filter((t) => t.passed).length || 0;
  const cookieCount = response?.cookies?.length || 0;
  const headerCount = Object.keys(response?.headers || {}).length;

  if (isLoading) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-4 border-l p-6 ${
        isDark ? 'border-neutral-800/80 bg-[#13161f] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}>
        <div className="relative flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-3 border-violet-500 border-t-transparent" />
          <div className="absolute h-5 w-5 rounded-full bg-violet-500/20 animate-pulse" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xs font-bold tracking-wide">Executing Request...</span>
          <span className="text-[11px] text-slate-500">Live connection pooling & SSL handshake</span>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-3 border-l p-8 text-center ${
        isDark ? 'border-neutral-800/80 bg-[#13161f] text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-500'
      }`}>
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
          isDark ? 'border-neutral-800 bg-[#181b26] shadow-inner' : 'border-slate-200 bg-white shadow-sm'
        }`}>
          <Globe className={`h-7 w-7 ${isDark ? 'text-slate-600' : 'text-slate-400'}`} />
        </div>
        <div className="flex flex-col gap-1 max-w-xs">
          <span className={`text-sm font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Ready to Inspect</span>
          <span className="text-xs leading-relaxed text-slate-400">
            Hit <strong className="text-violet-400 font-bold">Send</strong> to execute request and inspect telemetry.
          </span>
        </div>
      </div>
    );
  }

  const badgeInfo = getStatusBadge(response.statusCode);

  // Timing waterfall calculation
  const totalMs = Math.max(response.timing?.totalDurationMs || 1, 1);
  const timingPhases = [
    { name: 'DNS Resolution', ms: response.timing?.dnsDurationMs || 0, color: 'bg-cyan-500', barColor: '#06b6d4' },
    { name: 'TCP Handshake', ms: response.timing?.tcpDurationMs || 0, color: 'bg-indigo-500', barColor: '#6366f1' },
    { name: 'TLS Handshake', ms: response.timing?.tlsDurationMs || 0, color: 'bg-violet-500', barColor: '#8b5cf6' },
    { name: 'TTFB (Latency)', ms: response.timing?.ttfbDurationMs || 0, color: 'bg-amber-500', barColor: '#f59e0b' },
    { name: 'Content Download', ms: response.timing?.downloadDurationMs || 0, color: 'bg-emerald-500', barColor: '#10b981' },
  ];

  return (
    <div className={`flex h-full flex-col border-l overflow-hidden ${
      isDark ? 'border-neutral-800/80 bg-[#13161f]' : 'border-slate-200 bg-white'
    }`}>
      {/* 1. Telemetry Header Ribbon */}
      <div className={`flex items-center justify-between border-b px-4 py-2 select-none ${
        isDark ? 'border-neutral-800/80 bg-[#161924]' : 'border-slate-200 bg-slate-100/90'
      }`}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Badge: e.g. "200 OK" in solid green */}
          {response.statusCode > 0 ? (
            <div className={`flex items-center rounded-md px-2.5 py-1 text-xs font-black tracking-wide shadow-sm ${badgeInfo.bg}`}>
              {badgeInfo.label}
            </div>
          ) : (
            <div className="flex items-center rounded-md bg-rose-600 px-2.5 py-1 text-xs font-black text-white">
              ERROR
            </div>
          )}

          {/* Time Chip: e.g. "253 ms" */}
          <div className={`flex items-center rounded-md px-2.5 py-1 text-xs font-bold ${
            isDark ? 'bg-neutral-800/90 text-slate-200' : 'bg-white text-slate-800 border border-slate-300 shadow-2xs'
          }`}>
            <span>{response.timing?.totalDurationMs ?? 0} ms</span>
          </div>

          {/* Size Chip: e.g. "1372 B" */}
          <div className={`flex items-center rounded-md px-2.5 py-1 text-xs font-bold ${
            isDark ? 'bg-neutral-800/90 text-slate-200' : 'bg-white text-slate-800 border border-slate-300 shadow-2xs'
          }`}>
            <span>{formatSize(response.size || 0)}</span>
          </div>

          {/* Timestamp Chip: e.g. "Just Now ▾" */}
          <div className="text-[11px] font-bold text-slate-400 pl-1">
            Just Now ▾
          </div>
        </div>

        {/* Action Controls: Copy & Download */}
        <div className="flex items-center gap-1.5">
          {response.body && (
            <button
              onClick={downloadResponse}
              className={`rounded-md p-1.5 text-xs transition ${
                isDark ? 'text-slate-400 hover:bg-neutral-800 hover:text-white' : 'text-slate-600 hover:bg-slate-200'
              }`}
              title="Download Response File"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          )}

          {response.body && (
            <button
              onClick={copyToClipboard}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold transition shadow-2xs ${
                copied
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : isDark
                    ? 'border-neutral-700 bg-neutral-800 text-slate-200 hover:text-white'
                    : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
              }`}
              title="Copy to Clipboard"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Sub-Tabs Bar: Preview ▾, Headers 10, Cookies, Timeline */}
      <div className={`flex items-center border-b px-3 gap-3 text-xs font-bold select-none overflow-x-auto ${
        isDark ? 'border-neutral-800/80 bg-[#13161f] text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}>
        {/* Editor with Folds */}
        <button
          onClick={() => setActiveTab('editor')}
          className={`py-2 px-2 border-b-2 transition ${
            activeTab === 'editor'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
          title="Foldable Code Editor View"
        >
          Preview ▾
        </button>

        {/* Tree View */}
        <button
          onClick={() => setActiveTab('tree')}
          className={`py-2 px-2 border-b-2 transition ${
            activeTab === 'tree'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
          title="Collapsible Tree View"
        >
          Tree View
        </button>

        {/* Headers with Count Badge (Headers 10) */}
        <button
          onClick={() => setActiveTab('headers')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 ${
            activeTab === 'headers'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>Headers</span>
          {headerCount > 0 && (
            <span className="text-[10px] text-slate-400 font-bold opacity-80">{headerCount}</span>
          )}
        </button>

        {/* Cookies */}
        <button
          onClick={() => setActiveTab('cookies')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 ${
            activeTab === 'cookies'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>Cookies</span>
          {cookieCount > 0 && (
            <span className="text-[10px] text-amber-400 font-bold">{cookieCount}</span>
          )}
        </button>

        {/* Timeline / Waterfall */}
        <button
          onClick={() => setActiveTab('timeline')}
          className={`py-2 px-2 border-b-2 transition ${
            activeTab === 'timeline'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          Timeline
        </button>

        {/* Tests */}
        <button
          onClick={() => setActiveTab('tests')}
          className={`py-2 px-2 border-b-2 transition flex items-center gap-1 ${
            activeTab === 'tests'
              ? isDark ? 'border-violet-500 text-white font-extrabold' : 'border-violet-600 text-violet-700 font-extrabold'
              : isDark ? 'border-transparent text-slate-400 hover:text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>Tests</span>
          {testCount > 0 && (
            <span className={`text-[10px] font-black px-1.5 py-0.2 rounded-full ${
              passedCount === testCount ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
            }`}>
              {passedCount}/{testCount}
            </span>
          )}
        </button>
      </div>

      {/* 3. Panel Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Tab 1: Code Editor with Folding */}
        {activeTab === 'editor' && (
          <div className="h-full">
            <CodeEditor
              rawJson={response.body || ''}
              isDark={isDark}
              filterPath={jsonPathQuery}
            />
          </div>
        )}

        {/* Tab 2: Recursive Interactive Tree View */}
        {activeTab === 'tree' && (
          <div className="h-full">
            <JSONTreeViewer
              rawJson={response.body || ''}
              searchTerm={jsonPathQuery}
              isDark={isDark}
            />
          </div>
        )}

        {/* Tab 3: Response Headers */}
        {activeTab === 'headers' && (
          <div className="h-full p-4 overflow-auto flex flex-col gap-3">
            <input
              type="text"
              value={headerFilter}
              onChange={(e) => setHeaderFilter(e.target.value)}
              placeholder="Filter headers..."
              className={`rounded-xl border px-3 py-1.5 text-xs focus:outline-none ${
                isDark ? 'border-neutral-800 bg-[#161924] text-white placeholder-slate-500' : 'border-slate-300 bg-white text-slate-800'
              }`}
            />
            <div className={`rounded-xl border overflow-hidden ${
              isDark ? 'border-neutral-800 bg-[#161924]' : 'border-slate-300 bg-white shadow-sm'
            }`}>
              <table className="w-full text-left text-xs font-mono">
                <thead className={`uppercase text-[10px] font-bold border-b ${
                  isDark ? 'bg-neutral-900 border-neutral-800 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}>
                  <tr>
                    <th className="px-4 py-2 font-bold">Header</th>
                    <th className="px-4 py-2 font-bold">Value</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-neutral-800/60' : 'divide-slate-100'}`}>
                  {Object.entries(response.headers || {})
                    .filter(([k, v]) => {
                      if (!headerFilter) return true;
                      const f = headerFilter.toLowerCase();
                      return k.toLowerCase().includes(f) || String(v).toLowerCase().includes(f);
                    })
                    .map(([key, vals]) => (
                      <tr key={key} className={isDark ? 'hover:bg-neutral-800/30' : 'hover:bg-slate-50'}>
                        <td className="px-4 py-2 font-bold text-violet-400 whitespace-nowrap">{key}</td>
                        <td className={`px-4 py-2 break-all ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>
                          {Array.isArray(vals) ? (vals as string[]).join(', ') : String(vals)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 4: Cookies */}
        {activeTab === 'cookies' && (
          <div className="h-full p-4 overflow-auto flex flex-col gap-3">
            <span className="text-xs font-bold text-slate-400">Session Cookies ({cookieCount})</span>
            <div className={`rounded-xl border overflow-hidden ${
              isDark ? 'border-neutral-800 bg-[#161924]' : 'border-slate-300 bg-white shadow-sm'
            }`}>
              {cookieCount > 0 ? (
                <table className="w-full text-left text-xs font-mono">
                  <thead className={`uppercase text-[10px] font-bold border-b ${
                    isDark ? 'bg-neutral-900 border-neutral-800 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-700'
                  }`}>
                    <tr>
                      <th className="px-4 py-2 font-bold">Name</th>
                      <th className="px-4 py-2 font-bold">Value</th>
                      <th className="px-4 py-2 font-bold">Domain</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-neutral-800/60' : 'divide-slate-100'}`}>
                    {response.cookies.map((c, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-bold text-amber-400">{c.name}</td>
                        <td className={`px-4 py-2 break-all ${isDark ? 'text-slate-300' : 'text-slate-800'}`}>{c.value}</td>
                        <td className="px-4 py-2 text-slate-400">{c.domain || '/'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 italic">No cookies returned.</div>
              )}
            </div>
          </div>
        )}

        {/* Tab 5: Timeline / Waterfall */}
        {activeTab === 'timeline' && (
          <div className="h-full p-4 overflow-auto flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300">Network Timing Breakdown</span>
              <span className="text-xs font-black text-emerald-400">Total: {totalMs} ms</span>
            </div>

            <div className="h-3.5 w-full rounded-full bg-neutral-800/80 overflow-hidden flex shadow-inner">
              {timingPhases.map((phase) => {
                const widthPct = Math.max((phase.ms / totalMs) * 100, phase.ms > 0 ? 2 : 0);
                if (widthPct === 0) return null;
                return (
                  <div
                    key={phase.name}
                    style={{ width: `${widthPct}%`, backgroundColor: phase.barColor }}
                    className="h-full"
                    title={`${phase.name}: ${phase.ms} ms`}
                  />
                );
              })}
            </div>

            <div className={`rounded-xl border divide-y ${
              isDark ? 'border-neutral-800 bg-[#161924] divide-neutral-800' : 'border-slate-300 bg-white divide-slate-100 shadow-sm'
            }`}>
              {timingPhases.map((phase) => (
                <div key={phase.name} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${phase.color}`} />
                    <span className={`font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{phase.name}</span>
                  </div>
                  <span className="font-mono font-bold text-slate-200">{phase.ms} ms</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 6: Tests */}
        {activeTab === 'tests' && (
          <div className="h-full p-4 overflow-auto flex flex-col gap-3">
            <span className="text-xs font-bold text-slate-300">Automated Test Results ({passedCount}/{testCount})</span>
            {testCount > 0 ? (
              response.testResults.map((t, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
                    t.passed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  }`}
                >
                  {t.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> : <XCircle className="h-4 w-4 text-rose-400 shrink-0" />}
                  <span className="font-bold">{t.name}</span>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-xs text-slate-500 italic">No tests defined.</div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Bar: JSONPath Filter Query */}
      <div className={`flex items-center border-t px-3 py-1.5 text-xs font-mono select-none ${
        isDark ? 'border-neutral-800/80 bg-[#10121a]' : 'border-slate-200 bg-slate-100'
      }`}>
        <Filter className="h-3 w-3 text-slate-500 shrink-0 mr-1.5" />
        <input
          type="text"
          value={jsonPathQuery}
          onChange={(e) => setJsonPathQuery(e.target.value)}
          placeholder="$.store.books[*].author  (Filter response with JSONPath)"
          className={`w-full bg-transparent text-xs font-mono focus:outline-none ${
            isDark ? 'text-slate-300 placeholder-slate-600' : 'text-slate-800 placeholder-slate-400'
          }`}
        />
        <span title="JSONPath syntax help (e.g. $.store.books[*].author)">
          <HelpCircle className="h-3.5 w-3.5 text-slate-500 shrink-0 cursor-pointer hover:text-slate-300 ml-2" />
        </span>
      </div>
    </div>
  );
};
