import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertCircle, Terminal } from 'lucide-react';
import { ImportCollectionJSON, ImportCSV, ImportCurlCommand } from '../../wailsjs/go/main/App';
import { useTheme } from '../context/ThemeContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => Promise<void> | void;
  initialTab?: 'collection' | 'csv' | 'curl';
}

export const ImportModal: React.FC<Props> = ({ isOpen, onClose, onImportComplete, initialTab = 'collection' }) => {
  const { isDark, accentDef } = useTheme();
  const [tab, setTab] = useState<'collection' | 'csv' | 'curl'>(initialTab);
  const [content, setContent] = useState('');
  const [targetCollectionName, setTargetCollectionName] = useState('Imported Endpoints');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  React.useEffect(() => {
    if (isOpen && initialTab) {
      setTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setContent(text);
      if (tab === 'csv' && file.name) {
        setTargetCollectionName(file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!content.trim()) {
      setStatusMessage({ type: 'error', text: 'Please upload a file or paste content to import.' });
      return;
    }

    setIsLoading(true);
    setStatusMessage(null);

    try {
      if (tab === 'collection') {
        const count = await ImportCollectionJSON(content);
        setStatusMessage({
          type: 'success',
          text: `Imported & auto-saved ${count} requests from JSON / OpenAPI v2 spec!`,
        });
      } else if (tab === 'csv') {
        const count = await ImportCSV(targetCollectionName, content);
        setStatusMessage({
          type: 'success',
          text: `Imported & auto-saved ${count} endpoints from CSV into "${targetCollectionName}"!`,
        });
      } else if (tab === 'curl') {
        const req = await ImportCurlCommand(targetCollectionName, content);
        setStatusMessage({
          type: 'success',
          text: `Imported & auto-saved cURL request "${req.name}" into "${targetCollectionName}"!`,
        });
      }

      await onImportComplete();
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `Import failed: ${err?.message || err}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm select-none p-4 animate-in fade-in duration-150">
      <div className={`flex h-[560px] w-[720px] flex-col rounded-2xl border shadow-2xl overflow-hidden ${
        isDark ? 'border-neutral-800 bg-neutral-900/95 text-neutral-100 shadow-neutral-950/80' : 'border-neutral-200 bg-white text-neutral-900 shadow-slate-300'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between border-b px-5 py-3.5 ${
          isDark ? 'border-neutral-800' : 'border-neutral-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-bold">Import Collections & APIs</h2>
          </div>
          <button
            onClick={onClose}
            className={`rounded-lg p-1.5 transition ${
              isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-slate-200'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Format Tabs */}
        <div className={`flex border-b px-5 gap-6 text-xs font-semibold ${
          isDark ? 'border-neutral-800 bg-neutral-950/60 text-neutral-400' : 'border-neutral-200 bg-slate-100/60 text-neutral-600'
        }`}>
          <button
            onClick={() => {
              setTab('collection');
              setContent('');
              setStatusMessage(null);
            }}
            className={`py-3 transition border-b-2 ${
              tab === 'collection'
                ? `${accentDef.activeBorder} ${isDark ? 'text-white' : 'text-neutral-900'} font-bold`
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            Collection / OpenAPI v2 (.json)
          </button>

          <button
            onClick={() => {
              setTab('csv');
              setContent('');
              setTargetCollectionName('Imported CSV');
              setStatusMessage(null);
            }}
            className={`py-3 transition border-b-2 ${
              tab === 'csv'
                ? `${accentDef.activeBorder} ${isDark ? 'text-white' : 'text-neutral-900'} font-bold`
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            Spreadsheet (.csv)
          </button>

          <button
            onClick={() => {
              setTab('curl');
              setContent('');
              setTargetCollectionName('cURL Imports');
              setStatusMessage(null);
            }}
            className={`py-3 flex items-center gap-1.5 transition border-b-2 ${
              tab === 'curl'
                ? `${accentDef.activeBorder} ${isDark ? 'text-white' : 'text-neutral-900'} font-bold`
                : 'border-transparent hover:text-neutral-200'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>Raw cURL Command</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex flex-1 flex-col p-5 gap-4 overflow-y-auto">
          {tab === 'collection' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-neutral-400">
                Upload or paste a standard Collection v2.0 / v2.1 JSON or OpenAPI v2 (Swagger 2.0) JSON file. Pulse will import all folders and requests into your workspace.
              </span>
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="block w-full text-xs text-neutral-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
              />
            </div>
          )}

          {tab === 'csv' && (
            <div className="flex flex-col gap-3">
              <span className="text-xs text-neutral-400">
                Upload a CSV spreadsheet with columns: <code className="text-indigo-400">Method, URL, Name, Headers, Body</code>.
              </span>
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="block flex-1 text-xs text-neutral-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer"
                />
                <input
                  type="text"
                  value={targetCollectionName}
                  onChange={(e) => setTargetCollectionName(e.target.value)}
                  placeholder="Target Collection Folder"
                  className={`rounded-xl border px-3 py-1.5 text-xs focus:outline-none ${
                    isDark ? 'border-neutral-800 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-900'
                  }`}
                />
              </div>
            </div>
          )}

          {tab === 'curl' && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-neutral-400">
                Paste any standard cURL command. Pulse will parse the method, URL, headers, and payload into a saved request.
              </span>
              <input
                type="text"
                value={targetCollectionName}
                onChange={(e) => setTargetCollectionName(e.target.value)}
                placeholder="Target Collection Folder (e.g., Quick cURLs)"
                className={`rounded-xl border px-3 py-1.5 text-xs focus:outline-none ${
                  isDark ? 'border-neutral-800 bg-neutral-950 text-white' : 'border-neutral-300 bg-white text-neutral-900'
                }`}
              />
            </div>
          )}

          {/* Text Area */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={
              tab === 'collection'
                ? '{\n  "info": {\n    "name": "My API Collection",\n    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"\n  },\n  "item": [...]\n}'
                : tab === 'csv'
                  ? 'Method,URL,Name\nGET,https://api.example.com/users,Get Users\nPOST,https://api.example.com/users,Create User'
                  : 'curl -X POST https://api.example.com/v1/auth/login -H "Content-Type: application/json" -d \'{"username":"admin"}\''
            }
            rows={10}
            className={`flex-1 w-full rounded-xl border p-3 font-mono text-xs focus:outline-none ${
              isDark ? 'border-neutral-800 bg-neutral-950/60 text-neutral-200' : 'border-neutral-200 bg-slate-50 text-neutral-900'
            }`}
          />

          {/* Status Message */}
          {statusMessage && (
            <div
              className={`flex items-center gap-2 rounded-xl p-3 text-xs ${
                statusMessage.type === 'success'
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border border-rose-500/30 bg-rose-500/10 text-rose-400'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-3 border-t px-5 py-3.5 ${
          isDark ? 'border-neutral-800 bg-neutral-950/60' : 'border-neutral-200 bg-slate-50'
        }`}>
          <button
            onClick={onClose}
            className="rounded-xl px-3.5 py-1.5 text-xs text-neutral-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={isLoading || !content.trim()}
            className={`rounded-xl px-4 py-1.5 text-xs font-semibold shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed ${accentDef.buttonClass}`}
          >
            {isLoading ? 'Importing...' : 'Start Import'}
          </button>
        </div>
      </div>
    </div>
  );
};
