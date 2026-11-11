import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { IconRail } from './components/IconRail';
import { TopUrlBar } from './components/TopUrlBar';
import { RequestComposer } from './components/RequestComposer';
import { ResponseViewer } from './components/ResponseViewer';
import { EnvironmentModal } from './components/EnvironmentModal';
import { ImportModal } from './components/ImportModal';
import { CollectionItem, Environment, RequestItem, HttpMethod } from './types';
import {
  SendRequest,
  LoadWorkspace,
  SaveRequest as apiSaveRequest,
  DeleteRequest as apiDeleteRequest,
  CreateCollection as apiCreateCollection,
  RenameCollection as apiRenameCollection,
  DeleteCollection as apiDeleteCollection,
  ExportCollectionJSON as apiExportCollectionJSON,
  ExportCollectionOpenAPIv2 as apiExportCollectionOpenAPIv2,
  ExportRequestJSON as apiExportRequestJSON,
  ExportRequestOpenAPIv2 as apiExportRequestOpenAPIv2,
  ShowInFolder as apiShowInFolder,
  SaveEnvironment as apiSaveEnvironment,
  DeleteEnvironment as apiDeleteEnvironment,
  ToggleFullscreen,
  GetAppVersion,
} from '../wailsjs/go/main/App';
import { engine, storage } from '../wailsjs/go/models';

const FALLBACK_REQUEST: RequestItem = {
  id: 'req_demo',
  name: 'Get Products',
  collection: 'Demo APIs',
  method: 'GET',
  url: '{{baseUrl}}/products',
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  queryParams: [{ key: 'limit', value: '10', enabled: true }],
  body: { type: 'none', raw: '' },
};

function Workspace() {
  const { isDark, toggleMode } = useTheme();

  // 1. Workspace State
  const [activeView, setActiveView] = useState<'client' | 'loadtest'>('client');
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeEnvId, setActiveEnvId] = useState<string>('');
  const [activeRequest, setActiveRequest] = useState<RequestItem>(FALLBACK_REQUEST);
  const [openTabs, setOpenTabs] = useState<RequestItem[]>([FALLBACK_REQUEST]);
  const [layoutMode, setLayoutMode] = useState<'side' | 'stacked'>('side');
  const [isSavedRecently, setIsSavedRecently] = useState(false);
  const [isExportedRecently, setIsExportedRecently] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [isCurlOpen, setIsCurlOpen] = useState(false);
  const [importInitialTab, setImportInitialTab] = useState<'collection' | 'csv' | 'curl'>('collection');
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // 2. Execution & Response State
  const [response, setResponse] = useState<engine.HTTPResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 3. Load workspace from disk on startup or refresh
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshWorkspace = useCallback(async (): Promise<CollectionItem[]> => {
    try {
      const data = await LoadWorkspace();
      if (data) {
        // Map collections
        const mappedColls: CollectionItem[] = (data.collections || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          requests: (c.requests || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            collection: r.collection || c.name,
            method: (r.method || 'GET') as HttpMethod,
            url: r.url || '',
            headers: r.headers || [],
            queryParams: r.queryParams || [],
            body: (() => {
              const b = r.body || { type: 'none', raw: '' };
              if (b.type === 'graphql' && b.raw) {
                try {
                  const parsed = JSON.parse(b.raw);
                  if (parsed && typeof parsed === 'object' && ('query' in parsed || 'variables' in parsed)) {
                    return {
                      type: 'graphql' as const,
                      raw: b.raw,
                      graphqlQuery: parsed.query || '',
                      graphqlVariables: typeof parsed.variables === 'string' ? parsed.variables : JSON.stringify(parsed.variables || {}, null, 2),
                    };
                  }
                } catch {}
              }
              return {
                type: b.type || 'none',
                raw: b.raw || '',
                jsonBody: b.type === 'json' && !b.raw?.trim()?.startsWith('<') ? b.raw : undefined,
                xmlBody: b.type === 'xml' && b.raw?.trim()?.startsWith('<') ? b.raw : undefined,
                rawBody: b.type === 'raw' ? b.raw : undefined,
                formBody: b.type === 'x-www-form-urlencoded' ? b.raw : undefined,
                graphqlQuery: b.graphqlQuery,
                graphqlVariables: b.graphqlVariables,
              };
            })(),
            preRequestScript: r.preRequestScript || '',
            postResponseScript: r.postResponseScript || '',
            lastModifiedAt: r.lastModifiedAt,
          })),
        }));
        setCollections(mappedColls);

        // Map environments
        const mappedEnvs: Environment[] = (data.environments || []).map((e: any) => ({
          id: e.id,
          name: e.name,
          variables: e.variables || {},
        }));
        setEnvironments(mappedEnvs);

        // Set active environment if not set
        setActiveEnvId((prevEnvId) => prevEnvId || mappedEnvs[0]?.id || '');

        // Set active request only on initial startup if still on unmodified fallback
        const firstReq = mappedColls[0]?.requests[0];
        if (firstReq) {
          setActiveRequest((prevReq) => {
            if (prevReq.id === FALLBACK_REQUEST.id && prevReq.method === FALLBACK_REQUEST.method && prevReq.url === FALLBACK_REQUEST.url) {
              setOpenTabs([firstReq]);
              return firstReq;
            }
            return prevReq;
          });
        }
        return mappedColls;
      }
    } catch (err) {
      console.error('Failed to load workspace:', err);
    }
    return [];
  }, []);

  useEffect(() => {
    refreshWorkspace();
    GetAppVersion().then((v) => {
      if (v) setAppVersion(v);
    }).catch(() => {});
  }, [refreshWorkspace]);

  const activeEnv = environments.find((e) => e.id === activeEnvId);

  const toSavedRequest = (req: RequestItem) => {
    let rawToSave = req.body.raw;
    if (req.body.type === 'graphql') {
      rawToSave = JSON.stringify({
        query: req.body.graphqlQuery || req.body.raw || '',
        variables: req.body.graphqlVariables || '',
      });
    }
    return new storage.SavedRequest({
      id: req.id,
      name: req.name,
      collection: req.collection || 'General',
      method: req.method,
      url: req.url,
      headers: req.headers.map((h) => new engine.HeaderPair(h)),
      queryParams: req.queryParams.map((p) => new engine.ParamPair(p)),
      body: new engine.RequestBody({
        type: req.body.type,
        raw: rawToSave,
      }),
      preRequestScript: req.preRequestScript || '',
      postResponseScript: req.postResponseScript || '',
      lastModifiedAt: Date.now(),
    });
  };

  // Handle Save Request to Disk
  const handleSaveActiveRequest = async () => {
    try {
      await apiSaveRequest(toSavedRequest(activeRequest));
      setIsSavedRecently(true);
      setTimeout(() => setIsSavedRecently(false), 2000);
      await refreshWorkspace();
    } catch (err) {
      console.error('Failed to save request to disk:', err);
    }
  };

  // Keyboard Shortcuts: F11 / Cmd+Shift+F for Fullscreen, Cmd+S / Ctrl+S for Save, Cmd+Shift+T for Theme
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'F11' ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f'))
      ) {
        e.preventDefault();
        ToggleFullscreen();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveActiveRequest();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeRequest, toggleMode]);

  // Live synchronizer for request name in header, tabs, and sidebar
  const handleRequestNameChange = (name: string) => {
    const targetId = activeRequest.id;
    setActiveRequest((prev) => ({ ...prev, name }));
    setOpenTabs((prevTabs) =>
      prevTabs.map((t) => (t.id === targetId ? { ...t, name } : t))
    );
    setCollections((prevColls) =>
      prevColls.map((c) => ({
        ...c,
        requests: c.requests.map((r) => (r.id === targetId ? { ...r, name } : r)),
      }))
    );
  };

  const handleCommitActiveRequestName = () => {
    if (activeRequest.id !== FALLBACK_REQUEST.id) {
      apiSaveRequest(toSavedRequest(activeRequest)).catch(() => {});
    }
  };

  const handleRenameRequest = (req: RequestItem, newName: string) => {
    const updated = { ...req, name: newName };
    if (activeRequest.id === req.id) {
      setActiveRequest(updated);
    }
    setOpenTabs((prevTabs) =>
      prevTabs.map((t) => (t.id === req.id ? { ...t, name: newName } : t))
    );
    setCollections((prevColls) =>
      prevColls.map((c) => ({
        ...c,
        requests: c.requests.map((r) => (r.id === req.id ? { ...r, name: newName } : r)),
      }))
    );
    if (req.id !== FALLBACK_REQUEST.id) {
      apiSaveRequest(toSavedRequest(updated)).catch(() => {});
    }
  };

  // Live synchronizer + automatic debounced persistence for all active request edits
  const handleActiveRequestChange = (updated: RequestItem) => {
    setActiveRequest(updated);
    setOpenTabs((prevTabs) =>
      prevTabs.map((t) => (t.id === updated.id ? updated : t))
    );
    setCollections((prevColls) =>
      prevColls.map((c) => {
        if (c.name === updated.collection) {
          const exists = c.requests.some((r) => r.id === updated.id);
          if (exists) {
            return {
              ...c,
              requests: c.requests.map((r) => (r.id === updated.id ? updated : r)),
            };
          } else {
            return {
              ...c,
              requests: [...c.requests, updated],
            };
          }
        } else {
          return {
            ...c,
            requests: c.requests.filter((r) => r.id !== updated.id),
          };
        }
      })
    );

    if (updated.id !== FALLBACK_REQUEST.id) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        apiSaveRequest(toSavedRequest(updated))
          .then(() => {
            setIsSavedRecently(true);
            setTimeout(() => setIsSavedRecently(false), 1200);
          })
          .catch(() => {});
      }, 400);
    }
  };

  // Reload workspace and focus newly imported requests right after import
  const handleImportComplete = async () => {
    const prevIds = new Set(collections.flatMap((c) => c.requests.map((r) => r.id)));
    const nextColls = await refreshWorkspace();
    const newlyImported = nextColls
      .flatMap((c) => c.requests)
      .find((r) => !prevIds.has(r.id));
    const targetReq = newlyImported || nextColls.flatMap((c) => c.requests)[0];
    if (targetReq) {
      setActiveRequest(targetReq);
      setResponse(null);
      setOpenTabs((prev) => (prev.some((t) => t.id === targetReq.id) ? prev : [...prev, targetReq]));
    }
  };

  const handleMethodChange = (method: HttpMethod) => {
    const updated = { ...activeRequest, method };
    handleActiveRequestChange(updated);
    if (updated.id !== FALLBACK_REQUEST.id) {
      apiSaveRequest(toSavedRequest(updated)).catch(() => {});
    }
  };

  const handleUrlChange = (url: string) => {
    handleActiveRequestChange({ ...activeRequest, url });
  };

  // Tab Selection & Sidebar Selection Handlers
  const handleSelectRequestFromSidebar = (req: RequestItem) => {
    const existingTab = openTabs.find((t) => t.id === req.id);
    const target = existingTab || req;
    setActiveRequest(target);
    setResponse(null);
    if (!existingTab) {
      setOpenTabs((prev) => [...prev, target]);
    }
  };

  const handleSelectTab = (tab: RequestItem) => {
    setActiveRequest(tab);
    setResponse(null);
  };

  const handleCloseTab = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newTabs = openTabs.filter((t) => t.id !== id);
    if (newTabs.length === 0) {
      const fallback = collections[0]?.requests[0] || FALLBACK_REQUEST;
      setOpenTabs([fallback]);
      setActiveRequest(fallback);
      setResponse(null);
    } else {
      setOpenTabs(newTabs);
      if (activeRequest.id === id) {
        setActiveRequest(newTabs[newTabs.length - 1]);
        setResponse(null);
      }
    }
  };

  const handleCloseOtherTabs = (keepId: string) => {
    const kept = openTabs.find((t) => t.id === keepId);
    if (!kept) return;
    setOpenTabs([kept]);
    if (activeRequest.id !== keepId) {
      setActiveRequest(kept);
      setResponse(null);
    }
  };

  const handleCloseAllTabs = () => {
    const cleanTab: RequestItem = {
      ...FALLBACK_REQUEST,
      id: `req_draft_${Date.now()}`,
      name: 'Untitled Request',
      collection: collections[0]?.name || 'General',
      method: 'GET',
      url: '',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      queryParams: [],
      body: { type: 'none', raw: '' },
    };
    setOpenTabs([cleanTab]);
    setActiveRequest(cleanTab);
    setResponse(null);
  };

  // Handle New Request - Immediately persists to disk and adds tab
  const handleNewRequest = async (collectionName: string) => {
    const targetColl = collectionName || collections[0]?.name || 'Demo APIs';
    const coll = collections.find((c) => c.name === targetColl);
    const count = (coll?.requests.length || 0) + 1;

    const newReq: RequestItem = {
      id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: `New Request ${count}`,
      collection: targetColl,
      method: 'GET',
      url: 'https://httpbin.org/get',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      queryParams: [],
      body: { type: 'none', raw: '' },
      preRequestScript: '',
      postResponseScript: '',
      lastModifiedAt: Date.now(),
    };

    try {
      await apiSaveRequest(
        new storage.SavedRequest({
          id: newReq.id,
          name: newReq.name,
          collection: newReq.collection,
          method: newReq.method,
          url: newReq.url,
          headers: newReq.headers.map((h) => new engine.HeaderPair(h)),
          queryParams: newReq.queryParams.map((p) => new engine.ParamPair(p)),
          body: new engine.RequestBody(newReq.body),
          preRequestScript: '',
          postResponseScript: '',
          lastModifiedAt: Date.now(),
        })
      );
      await refreshWorkspace();
      setActiveRequest(newReq);
      setOpenTabs((prev) => {
        const exists = prev.some((t) => t.id === newReq.id);
        if (exists) return prev;
        return [...prev, newReq];
      });
      setResponse(null);
    } catch (err) {
      console.error('Failed to create new request:', err);
    }
  };

  const handleNewTab = () => {
    handleNewRequest(activeRequest.collection);
  };

  // Handle Delete Request
  const handleDeleteRequest = async (id: string, collectionName: string) => {
    try {
      await apiDeleteRequest(id, collectionName);
      await refreshWorkspace();
      setOpenTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeRequest.id === id) {
        setResponse(null);
      }
    } catch (err) {
      console.error('Failed to delete request:', err);
    }
  };

  // Handle Create Collection Folder
  const handleCreateCollection = async (name: string) => {
    try {
      await apiCreateCollection(name);
      await refreshWorkspace();
    } catch (err) {
      console.error('Failed to create collection:', err);
    }
  };

  // Handle Rename Collection Folder
  const handleRenameCollection = async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    try {
      await apiRenameCollection(oldName, trimmed);
      setOpenTabs((prev) =>
        prev.map((t) => (t.collection === oldName ? { ...t, collection: trimmed } : t))
      );
      setActiveRequest((prev) =>
        prev.collection === oldName ? { ...prev, collection: trimmed } : prev
      );
      await refreshWorkspace();
    } catch (err) {
      console.error('Failed to rename collection:', err);
      await refreshWorkspace();
    }
  };

  // Handle Delete Collection Folder
  const handleDeleteCollection = async (name: string) => {
    try {
      // Optimistically update collections list immediately for instant UI responsiveness
      setCollections((prev) => prev.filter((c) => c.name !== name));
      
      // Delete on disk
      await apiDeleteCollection(name);
      await refreshWorkspace();

      // Remove any open tabs belonging to this collection
      setOpenTabs((prev) => {
        const remaining = prev.filter((t) => t.collection !== name);
        return remaining.length > 0 ? remaining : [FALLBACK_REQUEST];
      });
      if (activeRequest.collection === name) {
        setResponse(null);
        setActiveRequest(FALLBACK_REQUEST);
      }
    } catch (err) {
      console.error('Failed to delete collection:', err);
      await refreshWorkspace();
    }
  };

  // Handle Export Collection as JSON to ~/Downloads/
  const handleExportCollection = async (name: string) => {
    try {
      const savedPath = await apiExportCollectionJSON(name);
      setIsExportedRecently(true);
      setTimeout(() => setIsExportedRecently(false), 2000);
      try {
        await apiShowInFolder(savedPath);
      } catch {}
    } catch (err) {
      console.error('Failed to export collection:', err);
    }
  };

  // Handle Export Collection as OpenAPI v2 (Swagger 2.0) to ~/Downloads/
  const handleExportCollectionOpenAPI = async (name: string) => {
    try {
      const targetName = name || activeRequest.collection || collections[0]?.name || '';
      if (!targetName) return;
      const savedPath = await apiExportCollectionOpenAPIv2(targetName);
      setIsExportedRecently(true);
      setTimeout(() => setIsExportedRecently(false), 2000);
      try {
        await apiShowInFolder(savedPath);
      } catch {}
    } catch (err) {
      console.error('Failed to export OpenAPI v2 spec:', err);
    }
  };

  // Handle Export Single Request as JSON to ~/Downloads/
  const handleExportRequest = async (req: RequestItem = activeRequest) => {
    try {
      const savedPath = await apiExportRequestJSON(toSavedRequest(req));
      setIsExportedRecently(true);
      setTimeout(() => setIsExportedRecently(false), 2000);
      try {
        await apiShowInFolder(savedPath);
      } catch {}
    } catch (err) {
      console.error('Failed to export request:', err);
    }
  };

  // Handle Export Single Request as OpenAPI v2 (Swagger 2.0) to ~/Downloads/
  const handleExportRequestOpenAPI = async (req: RequestItem = activeRequest) => {
    try {
      const savedPath = await apiExportRequestOpenAPIv2(toSavedRequest(req));
      setIsExportedRecently(true);
      setTimeout(() => setIsExportedRecently(false), 2000);
      try {
        await apiShowInFolder(savedPath);
      } catch {}
    } catch (err) {
      console.error('Failed to export request OpenAPI v2 spec:', err);
    }
  };

  // Handle Environment Saves & Removals to Disk
  const handleSaveEnvironments = async (updatedEnvs: Environment[]) => {
    const keptIds = new Set(updatedEnvs.map((e) => e.id));
    const removedEnvs = environments.filter((e) => !keptIds.has(e.id));

    setEnvironments(updatedEnvs);
    for (const removed of removedEnvs) {
      try {
        await apiDeleteEnvironment(removed.id);
      } catch (err) {
        console.error('Failed to delete environment:', err);
      }
    }
    for (const env of updatedEnvs) {
      await apiSaveEnvironment(
        new storage.SavedEnvironment({
          id: env.id,
          name: env.name,
          variables: env.variables,
        })
      );
    }
    if (activeEnvId && !keptIds.has(activeEnvId)) {
      setActiveEnvId(updatedEnvs[0]?.id || '');
    }
  };

  // Handle Direct Environment Delete
  const handleDeleteEnvironment = async (id: string) => {
    const remaining = environments.filter((e) => e.id !== id);
    setEnvironments(remaining);
    if (activeEnvId === id) {
      setActiveEnvId(remaining[0]?.id || '');
    }
    try {
      await apiDeleteEnvironment(id);
    } catch (err) {
      console.error('Failed to delete environment from disk:', err);
      await refreshWorkspace();
    }
  };

  // Handle Send Request via Go Engine
  const handleSend = async () => {
    if (!activeRequest.url) return;
    setIsLoading(true);

    try {
      let bodyPayload = activeRequest.body.raw || '';
      if (activeRequest.body.type === 'graphql') {
        const query = activeRequest.body.graphqlQuery ?? activeRequest.body.raw ?? '';
        let vars = {};
        if (activeRequest.body.graphqlVariables?.trim()) {
          try {
            vars = JSON.parse(activeRequest.body.graphqlVariables);
          } catch {
            // Invalid variables JSON fallback
          }
        }
        bodyPayload = JSON.stringify({ query, variables: vars }, null, 2);
      }

      const engineReq = new engine.HTTPRequest({
        id: activeRequest.id,
        name: activeRequest.name,
        method: activeRequest.method,
        url: activeRequest.url,
        headers: activeRequest.headers.map((h) => new engine.HeaderPair(h)),
        queryParams: activeRequest.queryParams.map((p) => new engine.ParamPair(p)),
        body: new engine.RequestBody({
          type: activeRequest.body.type,
          raw: bodyPayload,
        }),
        variables: activeEnv ? activeEnv.variables : {},
        timeoutMs: 30000,
        insecureSkipVerify: false,
        preRequestScript: activeRequest.preRequestScript || '',
        postResponseScript: activeRequest.postResponseScript || '',
      });

      const result = await SendRequest(engineReq);
      setResponse(result);

      // Automatically sync variables modified by scripts into the active environment
      if (result.updatedVariables && Object.keys(result.updatedVariables).length > 0 && activeEnv) {
        const mergedVars = { ...activeEnv.variables, ...result.updatedVariables };
        const updatedEnvs = environments.map((e) => (e.id === activeEnv.id ? { ...e, variables: mergedVars } : e));
        handleSaveEnvironments(updatedEnvs);
      }
    } catch (err: any) {
      setResponse(
        new engine.HTTPResponse({
          statusCode: 0,
          statusText: 'Client Error',
          headers: {},
          body: '',
          size: 0,
          timing: new engine.TimingStats(),
          error: String(err?.message || err),
        })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenCurl = () => {
    setImportInitialTab('curl');
    setIsImportModalOpen(true);
  };

  const collectionNames = collections.map((c) => c.name);

  return (
    <div className={`flex h-screen w-screen flex-col font-sans select-none overflow-hidden transition-colors duration-200 ${
      isDark ? 'bg-[#0d0f17] text-neutral-100' : 'bg-[#f1f5f9] text-slate-900'
    }`}>
      {/* Top Header */}
      <Header
        environments={environments}
        activeEnvId={activeEnvId}
        onSelectEnv={setActiveEnvId}
        onOpenEnvModal={() => setIsEnvModalOpen(true)}
        requestName={activeRequest.name}
        onRequestNameChange={handleRequestNameChange}
        onRequestNameCommit={handleCommitActiveRequestName}
        onToggleFullscreen={ToggleFullscreen}
        onOpenImport={() => {
          setImportInitialTab('collection');
          setIsImportModalOpen(true);
        }}
        onExportRequest={() => handleExportRequest(activeRequest)}
        onExportRequestOpenAPI={() => handleExportRequestOpenAPI(activeRequest)}
        onExportCollectionJSON={() => handleExportCollection(activeRequest.collection || collections[0]?.name || '')}
        onExportCollectionOpenAPI={() => handleExportCollectionOpenAPI(activeRequest.collection || collections[0]?.name || '')}
        isExportedRecently={isExportedRecently}
        appVersion={appVersion}
      />

      {/* Main Workspace Multi-Pane Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Leftmost Icon Rail */}
        <IconRail
          activeView={activeView}
          onSelectView={setActiveView}
          onOpenPreferences={() => setIsEnvModalOpen(true)}
          onOpenCreateCollection={() => handleCreateCollection(`Collection ${collections.length + 1}`)}
          collectionNames={collectionNames}
        />

        {/* Sidebar Collections Tree */}
        <Sidebar
          collections={collections}
          activeRequestId={activeRequest.id}
          onSelectRequest={handleSelectRequestFromSidebar}
          onNewRequest={handleNewRequest}
          onCreateCollection={handleCreateCollection}
          onRenameCollection={handleRenameCollection}
          onDeleteCollection={handleDeleteCollection}
          onExportCollection={handleExportCollection}
          onExportCollectionOpenAPI={handleExportCollectionOpenAPI}
          onExportRequest={handleExportRequest}
          onRenameRequest={handleRenameRequest}
          onDeleteRequest={handleDeleteRequest}
          onOpenImport={() => {
            setImportInitialTab('collection');
            setIsImportModalOpen(true);
          }}
        />

        {/* Center & Right Workspace: Full Width TopUrlBar across both panes */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          {/* Dedicated Full-Width Top URL Bar with Tabs & Layout Toggle */}
          <TopUrlBar
            request={activeRequest}
            activeEnv={activeEnv}
            onMethodChange={handleMethodChange}
            onUrlChange={handleUrlChange}
            onSend={handleSend}
            onSave={handleSaveActiveRequest}
            isLoading={isLoading}
            isSavedRecently={isSavedRecently}
            isCurlOpen={isCurlOpen}
            onToggleCurl={handleOpenCurl}
            layoutMode={layoutMode}
            onToggleLayout={() => setLayoutMode((prev) => (prev === 'side' ? 'stacked' : 'side'))}
            openTabs={openTabs}
            activeRequestId={activeRequest.id}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseAllTabs={handleCloseAllTabs}
            onNewTab={handleNewTab}
          />

          {/* Flexible Split Container: Side-by-Side vs Stacked Rows */}
          {layoutMode === 'side' ? (
            <div className="flex flex-1 overflow-hidden min-h-0 min-w-0">
              {/* Request Composer (Left/Center Pane) */}
              <div className={`w-1/2 min-w-0 min-h-0 flex flex-col overflow-hidden border-r ${isDark ? 'border-neutral-800/80' : 'border-slate-200'}`}>
                <RequestComposer
                  request={activeRequest}
                  onChange={handleActiveRequestChange}
                  isLoading={isLoading}
                  collectionNames={collectionNames}
                  activeEnv={activeEnv}
                  isCurlOpen={isCurlOpen}
                  onCloseCurl={() => setIsCurlOpen(false)}
                  activeView={activeView}
                />
              </div>

              {/* Response Viewer (Right Pane) */}
              <div className="w-1/2 min-w-0 min-h-0 flex flex-col overflow-hidden">
                <ResponseViewer response={response} isLoading={isLoading} />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden min-h-0 min-w-0">
              {/* Request Composer (Top Pane) */}
              <div className={`h-1/2 min-h-0 flex flex-col overflow-hidden border-b ${isDark ? 'border-neutral-800/80' : 'border-slate-200'}`}>
                <RequestComposer
                  request={activeRequest}
                  onChange={handleActiveRequestChange}
                  isLoading={isLoading}
                  collectionNames={collectionNames}
                  activeEnv={activeEnv}
                  isCurlOpen={isCurlOpen}
                  onCloseCurl={() => setIsCurlOpen(false)}
                  activeView={activeView}
                />
              </div>

              {/* Response Viewer (Bottom Pane) */}
              <div className="h-1/2 min-h-0 flex flex-col overflow-hidden">
                <ResponseViewer response={response} isLoading={isLoading} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <footer className={`flex h-6.5 items-center justify-between border-t px-4 text-[10px] select-none ${
        isDark ? 'border-neutral-800/80 bg-[#0d0f17] text-slate-500' : 'border-slate-200 bg-slate-100 text-slate-500'
      }`}>
        <div className="flex items-center gap-3 font-semibold">
          <button
            onClick={() => setIsEnvModalOpen(true)}
            className="flex items-center gap-1.5 hover:text-slate-300 transition"
          >
            <span>⚙ Preferences</span>
          </button>
          <span>•</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>Local Engine Active</span>
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span>Pulse v{appVersion} • Made with 💜 for Developers</span>
        </div>
      </footer>

      {/* Environment Management Modal */}
      <EnvironmentModal
        isOpen={isEnvModalOpen}
        onClose={() => setIsEnvModalOpen(false)}
        environments={environments}
        onSave={handleSaveEnvironments}
        onDeleteEnv={handleDeleteEnvironment}
        activeEnvId={activeEnvId}
        onSelectEnv={(id) => setActiveEnvId(id)}
      />

      {/* Import Modal (Collection/OpenAPI, CSV, & cURL) */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
        initialTab={importInitialTab}
      />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Workspace />
    </ThemeProvider>
  );
}
