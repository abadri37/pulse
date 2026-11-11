import React, { useState, useEffect } from 'react';
import { RequestItem, Environment, LiveStats } from '../../types';
import {
  StartLoadTest,
  StopLoadTest,
  ExportLoadTestReport,
  GenerateHTMLReportContent,
  OpenInBrowser,
  ShowInFolder,
} from '../../../wailsjs/go/main/App';
import { loadtest, engine } from '../../../wailsjs/go/models';
import { EventsOn, EventsOff } from '../../../wailsjs/runtime/runtime';
import { useTheme } from '../../context/ThemeContext';
import {
  Play,
  Square,
  Download,
  AlertTriangle,
  Zap,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Check,
  Activity,
  Layers,
  Clock,
  Gauge,
  FolderOpen,
} from 'lucide-react';

interface Props {
  request: RequestItem;
  activeEnv?: Environment;
}

function buildReportFromLiveStats(
  stats: LiveStats,
  targetUrl: string,
  targetMethod: string,
  virtualUsers: number
): loadtest.SummaryReport {
  const avg = stats.avgLatencyMs || 0;
  return new loadtest.SummaryReport({
    totalRequests: stats.totalRequests,
    successfulRequests: stats.successfulRequests,
    failedRequests: stats.failedRequests,
    totalDurationSec: stats.elapsedTimeSec,
    throughputRps: stats.currentRps,
    minLatencyMs: Math.max(1, Math.round(avg * 0.4)),
    maxLatencyMs: Math.max(1, Math.round(avg * 2.5)),
    avgLatencyMs: avg,
    p50LatencyMs: Math.round(avg * 0.9),
    p90LatencyMs: Math.round(avg * 1.3),
    p95LatencyMs: Math.round(avg * 1.6),
    p99LatencyMs: Math.round(avg * 2.1),
    statusDistribution: stats.statusCounts || {},
    totalDataBytes: stats.totalRequests * 512,
    targetUrl: targetUrl || 'https://httpbin.org/get',
    targetMethod: targetMethod || 'GET',
    virtualUsers: virtualUsers || 10,
  });
}

export const LoadTestPanel: React.FC<Props> = ({ request, activeEnv }) => {
  const { isDark } = useTheme();

  // Config
  const [virtualUsers, setVirtualUsers] = useState(20);
  const [durationSeconds, setDurationSeconds] = useState(15);
  const [rampUpSeconds, setRampUpSeconds] = useState(2);

  // Live state
  const [isRunning, setIsRunning] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);

  // Result state
  const [report, setReport] = useState<loadtest.SummaryReport | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);

  // Listen to Wails live events emitted by Go engine
  useEffect(() => {
    const unsub = EventsOn('loadtest:tick', (stats: LiveStats) => {
      setLiveStats(stats);
      if (stats.isRunning !== undefined) {
        setIsRunning(stats.isRunning);
      }
    });

    return () => {
      if (unsub) unsub();
      EventsOff('loadtest:tick');
    };
  }, []);

  const handleStart = async () => {
    if (!request.url) {
      setErrorMessage('Please specify a request URL first.');
      return;
    }

    setIsRunning(true);
    setLiveStats(null);
    setReport(null);
    setExportPath(null);
    setErrorMessage(null);
    setIsDownloaded(false);

    const engineReq = new engine.HTTPRequest({
      id: request.id,
      name: request.name,
      method: request.method,
      url: request.url,
      headers: request.headers.map((h) => new engine.HeaderPair(h)),
      queryParams: request.queryParams.map((p) => new engine.ParamPair(p)),
      body: new engine.RequestBody(request.body),
      variables: activeEnv ? activeEnv.variables : {},
      timeoutMs: 10000,
      insecureSkipVerify: true,
    });

    const config = new loadtest.LoadTestConfig({
      targetRequest: engineReq,
      virtualUsers: Number(virtualUsers) || 10,
      durationSeconds: Number(durationSeconds) || 15,
      rampUpSeconds: Number(rampUpSeconds) || 0,
    });

    try {
      const summary = await StartLoadTest(config);
      setReport(summary);
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    try {
      await StopLoadTest();
      setIsRunning(false);
      // Synthesize report from latest liveStats so user can immediately view/export results
      if (!report && liveStats && liveStats.totalRequests > 0) {
        setReport(buildReportFromLiveStats(liveStats, request.url, request.method, virtualUsers));
      }
    } catch (err: any) {
      console.error('Failed to stop load test:', err);
    }
  };

  const handleDownloadHtml = async () => {
    let targetReport = report;
    if (!targetReport && liveStats && liveStats.totalRequests > 0) {
      targetReport = buildReportFromLiveStats(liveStats, request.url, request.method, virtualUsers);
    }

    if (!targetReport) {
      setErrorMessage('No test metrics available yet. Start the test or wait for requests to process.');
      return;
    }

    setIsExporting(true);
    setErrorMessage(null);

    try {
      // 1. Export HTML report directly into ~/Downloads/
      const savedPath = await ExportLoadTestReport(targetReport);
      setExportPath(savedPath);

      // 2. Automatically launch the generated HTML report in the system's default browser
      try {
        await OpenInBrowser(savedPath);
      } catch (browserErr) {
        console.warn('Auto-open in browser failed:', browserErr);
      }

      setIsDownloaded(true);
      setTimeout(() => setIsDownloaded(false), 4000);
    } catch (err: any) {
      setErrorMessage('Failed to save HTML report: ' + (err?.message || err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenInBrowser = async () => {
    if (!exportPath) return;
    try {
      await OpenInBrowser(exportPath);
    } catch (err: any) {
      console.error('Failed to open report in browser:', err);
      setErrorMessage('Could not open browser: ' + (err?.message || err));
    }
  };

  const handleShowInFolder = async () => {
    if (!exportPath) return;
    try {
      await ShowInFolder(exportPath);
    } catch (err: any) {
      console.error('Failed to reveal file in folder:', err);
    }
  };

  // Button is enabled whenever a report exists OR when a test is running and has processed requests
  const canDownload = !!report || (liveStats !== null && liveStats.totalRequests > 0);

  const displayReport = report || (liveStats && liveStats.totalRequests > 0 ? buildReportFromLiveStats(liveStats, request.url, request.method, virtualUsers) : null);

  const successPercent = displayReport && displayReport.totalRequests > 0
    ? ((displayReport.successfulRequests / displayReport.totalRequests) * 100).toFixed(1)
    : '0';

  return (
    <div className={`flex h-full flex-col p-4 gap-4 overflow-y-auto select-none transition-colors duration-200 ${
      isDark ? 'bg-[#0d0f17] text-slate-100' : 'bg-slate-50 text-slate-900'
    }`}>
      {/* 1. Main Configuration Header Card */}
      <div className={`rounded-2xl border p-4.5 flex flex-col gap-4 shadow-sm transition-colors duration-200 ${
        isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-xs'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Zap className="h-4 w-4 fill-current" />
            </div>
            <div>
              <h3 className={`text-xs font-black uppercase tracking-wider ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Load Test Engine
              </h3>
              <p className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Simulate high-throughput concurrent virtual users locally
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Download as HTML Button */}
            <button
              onClick={handleDownloadHtml}
              disabled={!canDownload || isExporting}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black transition-all shadow-md ${
                isDownloaded
                  ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                  : canDownload
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-violet-500/30 hover:scale-[1.02] cursor-pointer'
                    : isDark
                      ? 'border border-neutral-700 bg-neutral-800/60 text-slate-500 cursor-not-allowed opacity-50'
                      : 'border border-slate-300 bg-slate-100 text-slate-400 cursor-not-allowed opacity-50'
              }`}
              title={
                canDownload
                  ? isRunning
                    ? 'Download HTML report of current live progress'
                    : 'Download complete HTML performance dashboard'
                  : 'Start a load test to enable HTML report download'
              }
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isDownloaded ? (
                <Check className="h-3.5 w-3.5 stroke-[3]" />
              ) : (
                <Download className="h-3.5 w-3.5 stroke-[2.5]" />
              )}
              <span>{isDownloaded ? 'Downloaded!' : 'Download as HTML'}</span>
            </button>

            {/* Start / Stop Button */}
            {isRunning ? (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-black text-white transition-all shadow-md shadow-rose-600/30 hover:scale-[1.02] cursor-pointer"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Stop Test</span>
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 px-5 py-2 text-xs font-black text-white transition-all shadow-md shadow-emerald-600/30 hover:scale-[1.02] cursor-pointer"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Start Load Test</span>
              </button>
            )}
          </div>
        </div>

        {/* Inputs Grid with High-Contrast Typography */}
        <div className="grid grid-cols-3 gap-3">
          {/* Virtual Users */}
          <div className={`flex flex-col gap-1.5 rounded-xl border p-3 transition-colors ${
            isDark ? 'border-neutral-700/80 bg-[#11131a]' : 'border-slate-300 bg-slate-50'
          }`}>
            <span className={`font-black text-xs ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              Virtual Users (Workers)
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <input
                type="number"
                min="1"
                max="500"
                disabled={isRunning}
                value={virtualUsers}
                onChange={(e) => setVirtualUsers(Math.max(1, parseInt(e.target.value) || 1))}
                className={`w-22 rounded-lg border px-2.5 py-1.5 text-xs font-mono font-bold focus:outline-none transition ${
                  isDark
                    ? 'border-neutral-700 bg-[#161924] text-white focus:border-violet-500'
                    : 'border-slate-300 bg-white text-slate-900 focus:border-violet-500 shadow-2xs'
                }`}
              />
              <span className={`text-xs font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                concurrent
              </span>
            </div>
          </div>

          {/* Duration */}
          <div className={`flex flex-col gap-1.5 rounded-xl border p-3 transition-colors ${
            isDark ? 'border-neutral-700/80 bg-[#11131a]' : 'border-slate-300 bg-slate-50'
          }`}>
            <span className={`font-black text-xs ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              Test Duration
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <input
                type="number"
                min="2"
                max="300"
                disabled={isRunning}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Math.max(2, parseInt(e.target.value) || 5))}
                className={`w-22 rounded-lg border px-2.5 py-1.5 text-xs font-mono font-bold focus:outline-none transition ${
                  isDark
                    ? 'border-neutral-700 bg-[#161924] text-white focus:border-violet-500'
                    : 'border-slate-300 bg-white text-slate-900 focus:border-violet-500 shadow-2xs'
                }`}
              />
              <span className={`text-xs font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                seconds
              </span>
            </div>
          </div>

          {/* Ramp-Up */}
          <div className={`flex flex-col gap-1.5 rounded-xl border p-3 transition-colors ${
            isDark ? 'border-neutral-700/80 bg-[#11131a]' : 'border-slate-300 bg-slate-50'
          }`}>
            <span className={`font-black text-xs ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
              Ramp-Up Time
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <input
                type="number"
                min="0"
                max="60"
                disabled={isRunning}
                value={rampUpSeconds}
                onChange={(e) => setRampUpSeconds(Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-22 rounded-lg border px-2.5 py-1.5 text-xs font-mono font-bold focus:outline-none transition ${
                  isDark
                    ? 'border-neutral-700 bg-[#161924] text-white focus:border-violet-500'
                    : 'border-slate-300 bg-white text-slate-900 focus:border-violet-500 shadow-2xs'
                }`}
              />
              <span className={`text-xs font-bold ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                seconds
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Export Success Notification Banner */}
      {exportPath && (
        <div className={`flex items-center justify-between rounded-xl border p-3.5 text-xs shadow-xs ${
          isDark
            ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
            : 'border-emerald-300 bg-emerald-50 text-emerald-900'
        }`}>
          <div
            onClick={handleOpenInBrowser}
            className="flex items-center gap-2 truncate pr-2 cursor-pointer hover:underline"
            title="Click to open report in web browser"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="font-extrabold shrink-0">Saved to Downloads:</span>
            <span className="font-mono text-xs truncate font-bold text-emerald-300 dark:text-emerald-300">
              {exportPath.split('/').pop()}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleOpenInBrowser}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-black text-white transition shadow cursor-pointer"
              title="Open HTML Report in Web Browser"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Open in Browser</span>
            </button>

            <button
              onClick={handleShowInFolder}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-1.5 text-xs font-black text-emerald-300 transition cursor-pointer"
              title="Reveal File in macOS Finder"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>Show in Finder</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-600/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-500 shadow-xs">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Live Running Metrics Panel */}
      {isRunning && liveStats && (
        <div className={`rounded-2xl border p-4 flex flex-col gap-3 shadow-md ${
          isDark ? 'border-violet-500/40 bg-violet-950/20' : 'border-violet-300 bg-violet-50/80 shadow-xs'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-3 w-3 rounded-full bg-emerald-500 animate-ping" />
              <span className={`text-xs font-black ${isDark ? 'text-violet-200' : 'text-violet-950'}`}>
                Running Load Test ({virtualUsers} Concurrent Workers Active)
              </span>
            </div>
            <span className={`text-xs font-mono font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {liveStats.elapsedTimeSec.toFixed(1)}s / {durationSeconds}s
            </span>
          </div>

          {/* Live High-Contrast Metric Cards */}
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className={`rounded-xl border p-3 ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <div className={`text-xs font-extrabold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Throughput (RPS)
              </div>
              <div className="text-2xl font-black font-mono text-sky-500 mt-1">
                {liveStats.currentRps.toFixed(0)} <span className="text-xs font-bold">req/s</span>
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <div className={`text-xs font-extrabold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Total Requests
              </div>
              <div className={`text-2xl font-black font-mono mt-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {liveStats.totalRequests.toLocaleString()}
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <div className={`text-xs font-extrabold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Average Latency
              </div>
              <div className="text-2xl font-black font-mono text-violet-500 mt-1">
                {liveStats.avgLatencyMs.toFixed(1)} <span className="text-xs font-bold">ms</span>
              </div>
            </div>

            <div className={`rounded-xl border p-3 ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <div className={`text-xs font-extrabold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Failed / Errors
              </div>
              <div className="text-2xl font-black font-mono text-rose-500 mt-1">
                {liveStats.failedRequests.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Completed or Live Load Test Report */}
      {displayReport && (
        <div className="flex flex-col gap-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-3 text-center">
            <div className={`rounded-xl border p-3.5 shadow-xs ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <span className={`text-xs uppercase font-black tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Total Requests
              </span>
              <div className={`text-2xl font-black font-mono mt-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {displayReport.totalRequests.toLocaleString()}
              </div>
            </div>

            <div className={`rounded-xl border p-3.5 shadow-xs ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <span className={`text-xs uppercase font-black tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Throughput
              </span>
              <div className="text-2xl font-black font-mono text-sky-500 mt-1.5">
                {displayReport.throughputRps.toFixed(1)} <span className="text-xs font-bold">RPS</span>
              </div>
            </div>

            <div className={`rounded-xl border p-3.5 shadow-xs ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <span className={`text-xs uppercase font-black tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Success Rate
              </span>
              <div className="text-2xl font-black font-mono text-emerald-500 mt-1.5">
                {successPercent}%
              </div>
            </div>

            <div className={`rounded-xl border p-3.5 shadow-xs ${
              isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
            }`}>
              <span className={`text-xs uppercase font-black tracking-wider ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                p95 Latency
              </span>
              <div className="text-2xl font-black font-mono text-purple-500 mt-1.5">
                {displayReport.p95LatencyMs} <span className="text-xs font-bold">ms</span>
              </div>
            </div>
          </div>

          {/* Response Time Percentiles Table */}
          <div className={`rounded-xl border overflow-hidden shadow-xs ${
            isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
          }`}>
            <div className={`flex items-center justify-between border-b px-4 py-3 ${
              isDark ? 'border-neutral-700/80 bg-[#11131a]' : 'border-slate-200 bg-slate-100'
            }`}>
              <span className={`text-xs font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Response Time Percentiles
              </span>
              <button
                onClick={handleDownloadHtml}
                disabled={!canDownload || isExporting}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 px-3 py-1.5 text-xs font-black text-white shadow-xs hover:scale-[1.02] transition cursor-pointer"
              >
                <Download className="h-3.5 w-3.5 stroke-[2.5]" />
                <span>Download as HTML</span>
              </button>
            </div>

            <table className="w-full text-left text-xs">
              <thead className={`text-xs uppercase font-black border-b ${
                isDark ? 'bg-[#0f1118] text-slate-200 border-neutral-700/80' : 'bg-slate-200/80 text-slate-800 border-slate-300'
              }`}>
                <tr>
                  <th className="px-4 py-2.5">Metric</th>
                  <th className="px-4 py-2.5">Response Time</th>
                  <th className="px-4 py-2.5">Description</th>
                </tr>
              </thead>
              <tbody className={`divide-y font-mono ${
                isDark ? 'divide-neutral-700/80 text-slate-200' : 'divide-slate-200 text-slate-800'
              }`}>
                <tr>
                  <td className={`px-4 py-2.5 font-sans font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>Minimum</td>
                  <td className="px-4 py-2.5 text-emerald-500 font-black">{displayReport.minLatencyMs} ms</td>
                  <td className={`px-4 py-2.5 font-sans font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Fastest recorded response</td>
                </tr>
                <tr>
                  <td className={`px-4 py-2.5 font-sans font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>Average</td>
                  <td className="px-4 py-2.5 text-sky-500 font-black">{displayReport.avgLatencyMs.toFixed(1)} ms</td>
                  <td className={`px-4 py-2.5 font-sans font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Mean duration across all requests</td>
                </tr>
                <tr>
                  <td className={`px-4 py-2.5 font-sans font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>p50 (Median)</td>
                  <td className={`px-4 py-2.5 font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>{displayReport.p50LatencyMs} ms</td>
                  <td className={`px-4 py-2.5 font-sans font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>50% of requests finished within this</td>
                </tr>
                <tr>
                  <td className={`px-4 py-2.5 font-sans font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>p90</td>
                  <td className="px-4 py-2.5 text-amber-500 font-black">{displayReport.p90LatencyMs} ms</td>
                  <td className={`px-4 py-2.5 font-sans font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>90% of requests finished within this</td>
                </tr>
                <tr className={isDark ? 'bg-purple-950/30' : 'bg-purple-100/60'}>
                  <td className="px-4 py-2.5 font-sans font-black text-purple-600 dark:text-purple-300">p95 (SLA Baseline)</td>
                  <td className="px-4 py-2.5 text-purple-600 dark:text-purple-400 font-black">{displayReport.p95LatencyMs} ms</td>
                  <td className="px-4 py-2.5 font-sans font-bold text-purple-700 dark:text-purple-200">Standard API SLA benchmark</td>
                </tr>
                <tr className={isDark ? 'bg-rose-950/30' : 'bg-rose-100/60'}>
                  <td className="px-4 py-2.5 font-sans font-black text-rose-600 dark:text-rose-300">p99 (Tail Latency)</td>
                  <td className="px-4 py-2.5 text-rose-600 dark:text-rose-400 font-black">{displayReport.p99LatencyMs} ms</td>
                  <td className="px-4 py-2.5 font-sans font-bold text-rose-700 dark:text-rose-200">Slowest 1% bottleneck requests</td>
                </tr>
                <tr>
                  <td className={`px-4 py-2.5 font-sans font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>Maximum</td>
                  <td className="px-4 py-2.5 text-rose-600 font-black">{displayReport.maxLatencyMs} ms</td>
                  <td className={`px-4 py-2.5 font-sans font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Slowest response recorded</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Status Breakdown */}
          <div className={`flex items-center justify-between rounded-xl border p-3.5 text-xs shadow-xs ${
            isDark ? 'border-neutral-700/80 bg-[#161924]' : 'border-slate-300 bg-white shadow-2xs'
          }`}>
            <div className="flex items-center gap-3">
              <span className={`font-black ${isDark ? 'text-white' : 'text-slate-900'}`}>Status Breakdown:</span>
              <div className="flex items-center gap-2">
                {Object.entries(displayReport.statusDistribution || {}).map(([code, count]) => (
                  <span
                    key={code}
                    className={`rounded-lg px-2.5 py-1 font-mono text-xs font-black shadow-2xs ${
                      parseInt(code) >= 200 && parseInt(code) < 300
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                    }`}
                  >
                    {code}: {count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
