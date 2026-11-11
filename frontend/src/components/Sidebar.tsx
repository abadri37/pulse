import React, { useState, useMemo, useRef, useEffect } from 'react';
import { CollectionItem, RequestItem, HttpMethod } from '../types';
import { useTheme } from '../context/ThemeContext';
import {
  Folder,
  FolderOpen,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Upload,
  Search,
  FolderPlus,
  Compass,
  FileCode2,
  Download,
  AlertTriangle,
  Pencil,
} from 'lucide-react';

interface Props {
  collections: CollectionItem[];
  activeRequestId: string;
  onSelectRequest: (req: RequestItem) => void;
  onNewRequest: (collectionName: string) => void;
  onCreateCollection: (name: string) => void;
  onRenameCollection: (oldName: string, newName: string) => void;
  onDeleteCollection: (name: string) => void;
  onExportCollection: (name: string) => void;
  onExportCollectionOpenAPI: (name: string) => void;
  onExportRequest: (req: RequestItem) => void;
  onRenameRequest: (req: RequestItem, newName: string) => void;
  onDeleteRequest: (id: string, collectionName: string) => void;
  onOpenImport: () => void;
}

// HTTP method color badges
const METHOD_STYLES: Record<HttpMethod, { badge: string; text: string; bg: string }> = {
  GET: {
    badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    text: 'text-emerald-400',
    bg: 'hover:border-emerald-500/40',
  },
  POST: {
    badge: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
    text: 'text-violet-400',
    bg: 'hover:border-violet-500/40',
  },
  PUT: {
    badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    text: 'text-amber-400',
    bg: 'hover:border-amber-500/40',
  },
  PATCH: {
    badge: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
    text: 'text-cyan-400',
    bg: 'hover:border-cyan-500/40',
  },
  DELETE: {
    badge: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    text: 'text-rose-400',
    bg: 'hover:border-rose-500/40',
  },
  OPTIONS: {
    badge: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
    text: 'text-slate-400',
    bg: 'hover:border-slate-500/40',
  },
  HEAD: {
    badge: 'bg-teal-500/15 text-teal-400 border border-teal-500/30',
    text: 'text-teal-400',
    bg: 'hover:border-teal-500/40',
  },
};

export const Sidebar: React.FC<Props> = ({
  collections,
  activeRequestId,
  onSelectRequest,
  onNewRequest,
  onCreateCollection,
  onRenameCollection,
  onDeleteCollection,
  onExportCollection,
  onExportCollectionOpenAPI,
  onExportRequest,
  onRenameRequest,
  onDeleteRequest,
  onOpenImport,
}) => {
  const { isDark, accentDef } = useTheme();
  const [sidebarWidth, setSidebarWidth] = useState<number>(380);
  const isResizingRef = useRef(false);
  const [collapsedCollections, setCollapsedCollections] = useState<Record<string, boolean>>({});
  const [isCreatingColl, setIsCreatingColl] = useState(false);
  const [newCollName, setNewCollName] = useState('');
  const [creatingSubfolderFor, setCreatingSubfolderFor] = useState<string | null>(null);
  const [newSubfolderName, setNewSubfolderName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [collToDelete, setCollToDelete] = useState<CollectionItem | null>(null);
  const [editingCollId, setEditingCollId] = useState<string | null>(null);
  const [editingCollName, setEditingCollName] = useState('');
  const [editingReqId, setEditingReqId] = useState<string | null>(null);
  const [editingReqName, setEditingReqName] = useState('');

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      // Offset 52px accounts for IconRail width
      const nextWidth = Math.max(300, Math.min(600, e.clientX - 52));
      setSidebarWidth(nextWidth);
    };
    const onMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const toggleCollapse = (collKey: string) => {
    setCollapsedCollections((prev) => ({
      ...prev,
      [collKey]: !prev[collKey],
    }));
  };

  const countRequestsRecursive = (node: CollectionItem): number => {
    let total = node.requests.length;
    for (const sub of node.folders || []) {
      total += countRequestsRecursive(sub);
    }
    return total;
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCollName.trim()) {
      onCreateCollection(newCollName.trim());
      setNewCollName('');
      setIsCreatingColl(false);
    }
  };

  const filterNode = (node: CollectionItem, q: string): CollectionItem | null => {
    const nameMatches = node.name.toLowerCase().includes(q);
    if (nameMatches) return node;

    const matchingReqs = node.requests.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        r.method.toLowerCase().includes(q)
    );
    const matchingFolders = (node.folders || [])
      .map((sub) => filterNode(sub, q))
      .filter((x): x is CollectionItem => x !== null);

    if (matchingReqs.length > 0 || matchingFolders.length > 0) {
      return {
        ...node,
        requests: matchingReqs,
        folders: matchingFolders,
      };
    }
    return null;
  };

  // Filter collections, nested folders, and requests recursively by search query
  const filteredCollections = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    const q = searchQuery.toLowerCase();
    return collections
      .map((c) => filterNode(c, q))
      .filter((x): x is CollectionItem => x !== null);
  }, [collections, searchQuery]);

  const renderCollectionNode = (coll: CollectionItem, depth = 0): React.ReactNode => {
    const collPath = coll.path || coll.name;
    const isCollapsed = !searchQuery.trim() && !!collapsedCollections[collPath];
    const totalRequests = countRequestsRecursive(coll);
    const hasSubfolders = (coll.folders?.length || 0) > 0;

    return (
      <div key={collPath} className="flex flex-col">
        {/* Collection / Folder Header Row */}
        <div
          onClick={() => {
            if (editingCollId !== collPath) {
              toggleCollapse(collPath);
            }
          }}
          title={`${collPath} (${totalRequests} requests)`}
          className={`group flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-2 cursor-pointer text-[13px] font-bold transition select-none ${
            isDark
              ? 'border-transparent text-neutral-200 hover:border-neutral-700/80 hover:bg-neutral-800/85 hover:text-white'
              : 'border-transparent text-slate-800 hover:border-slate-300 hover:bg-slate-200/85 hover:text-slate-950'
          }`}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 text-neutral-400 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-neutral-400 shrink-0" />
            )}
            {isCollapsed ? (
              <Folder className={`h-4 w-4 shrink-0 ${depth === 0 ? 'text-amber-500/85' : 'text-indigo-400/90'}`} />
            ) : (
              <FolderOpen className={`h-4 w-4 shrink-0 ${depth === 0 ? 'text-amber-400' : 'text-indigo-400'}`} />
            )}
            {editingCollId === collPath ? (
              <input
                type="text"
                autoFocus
                value={editingCollName}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingCollName(e.target.value)}
                onBlur={() => {
                  const trimmed = editingCollName.trim();
                  if (trimmed && trimmed !== coll.name) {
                    onRenameCollection(collPath, trimmed);
                  }
                  setEditingCollId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    setEditingCollId(null);
                  }
                }}
                className={`w-full rounded px-1.5 py-0.5 text-xs font-bold select-text focus:outline-none border ${
                  isDark
                    ? 'bg-neutral-900 border-violet-500 text-white'
                    : 'bg-white border-violet-500 text-slate-900'
                }`}
              />
            ) : (
              <span
                className="truncate"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingCollId(collPath);
                  setEditingCollName(coll.name);
                }}
                title={`${collPath} (Double-click to rename)`}
              >
                {coll.name}
              </span>
            )}
            <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
              isDark ? 'bg-neutral-800/90 text-neutral-400 group-hover:text-neutral-200' : 'bg-slate-200 text-slate-700 group-hover:text-slate-900'
            }`}>
              {totalRequests}
            </span>
          </div>

          {/* Folder Actions: reveal cleanly on hover so deep nested names never squeeze */}
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditingCollId(collPath);
                setEditingCollName(coll.name);
              }}
              className={`rounded-lg p-1 transition ${
                isDark ? 'text-neutral-400 hover:bg-neutral-700 hover:text-violet-400' : 'text-slate-600 hover:bg-slate-300 hover:text-violet-600'
              }`}
              title={`Rename "${coll.name}"`}
            >
              <Pencil className="h-3 w-3" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedCollections((prev) => ({ ...prev, [collPath]: false }));
                setCreatingSubfolderFor(collPath);
                setNewSubfolderName('');
              }}
              className={`rounded-lg p-1 transition ${
                isDark ? 'text-neutral-400 hover:bg-neutral-700 hover:text-amber-400' : 'text-slate-600 hover:bg-slate-300 hover:text-amber-600'
              }`}
              title={`Create subfolder inside "${coll.name}"`}
            >
              <FolderPlus className="h-3 w-3" />
            </button>

            {depth === 0 && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExportCollectionOpenAPI(collPath);
                  }}
                  className={`rounded-lg px-1 py-0.5 text-[9px] font-black tracking-tight transition ${
                    isDark ? 'text-cyan-400 hover:bg-neutral-700 hover:text-cyan-300' : 'text-cyan-700 hover:bg-slate-300'
                  }`}
                  title={`Export "${coll.name}" as OpenAPI v2 (Swagger 2.0) JSON`}
                >
                  OA2
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExportCollection(collPath);
                  }}
                  className={`rounded-lg p-1 transition ${
                    isDark ? 'text-neutral-400 hover:bg-neutral-700 hover:text-emerald-400' : 'text-slate-600 hover:bg-slate-300 hover:text-emerald-600'
                  }`}
                  title={`Export "${coll.name}" as Collection JSON (to ~/Downloads)`}
                >
                  <Download className="h-3 w-3" />
                </button>
              </>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollapsedCollections((prev) => ({ ...prev, [collPath]: false }));
                onNewRequest(collPath);
              }}
              className={`rounded-lg p-1 transition ${
                isDark ? 'text-neutral-400 hover:bg-neutral-700 hover:text-white' : 'text-slate-600 hover:bg-slate-300 hover:text-slate-900'
              }`}
              title={`Add request inside "${coll.name}"`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollToDelete(coll);
              }}
              className={`rounded-lg p-1 transition ${
                isDark ? 'text-neutral-400 hover:bg-rose-500/20 hover:text-rose-400' : 'text-slate-600 hover:bg-rose-100 hover:text-rose-600'
              }`}
              title={`Delete "${coll.name}"`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Child Subfolders & Requests */}
        {!isCollapsed && (
          <div className={`ml-4 pl-3 border-l-2 flex flex-col gap-1 mt-1 ${
            isDark
              ? depth % 2 === 0 ? 'border-neutral-700/80' : 'border-indigo-500/30'
              : depth % 2 === 0 ? 'border-slate-300' : 'border-indigo-300/80'
          }`}>
            {creatingSubfolderFor === collPath && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const subName = newSubfolderName.trim();
                  if (subName) {
                    onCreateCollection(`${collPath}/${subName}`);
                    setCreatingSubfolderFor(null);
                    setNewSubfolderName('');
                  }
                }}
                className="flex items-center gap-1 py-1"
              >
                <input
                  type="text"
                  autoFocus
                  placeholder="Subfolder name..."
                  value={newSubfolderName}
                  onChange={(e) => setNewSubfolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setCreatingSubfolderFor(null);
                    }
                  }}
                  className={`flex-1 min-w-0 rounded-md border px-2 py-1 text-xs focus:outline-none ${
                    isDark
                      ? 'border-neutral-700 bg-neutral-900 text-neutral-100 focus:border-violet-500'
                      : 'border-slate-300 bg-white text-neutral-900 focus:border-violet-500'
                  }`}
                />
                <button
                  type="submit"
                  className={`rounded-md px-2 py-1 text-[10px] font-bold transition ${accentDef.buttonClass}`}
                >
                  Add
                </button>
              </form>
            )}

            {(coll.folders || []).map((sub) => renderCollectionNode(sub, depth + 1))}

            {coll.requests.map((req) => {
              const isActive = activeRequestId === req.id;
              const methodStyle = METHOD_STYLES[req.method] || METHOD_STYLES.GET;

              return (
                <div
                  key={req.id}
                  onClick={() => onSelectRequest(req)}
                  className={`group relative flex items-center justify-between rounded-xl px-2.5 py-1.5 cursor-pointer text-xs transition border ${
                    isActive
                      ? isDark
                        ? 'border-violet-500/40 bg-violet-950/20 text-white font-bold shadow-xs'
                        : 'border-violet-400 bg-violet-50 text-slate-900 font-bold shadow-xs'
                      : isDark
                        ? 'border-transparent text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
                        : 'border-transparent text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-violet-500 shadow-sm shadow-violet-500/50" />
                  )}

                  <div className="flex items-center gap-2 truncate pl-1 flex-1 min-w-0">
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md tracking-wider shrink-0 ${methodStyle.badge}`}>
                      {req.method}
                    </span>
                    {editingReqId === req.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingReqName}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingReqName(e.target.value)}
                        onBlur={() => {
                          const trimmed = editingReqName.trim();
                          if (trimmed && trimmed !== req.name) {
                            onRenameRequest(req, trimmed);
                          }
                          setEditingReqId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            setEditingReqId(null);
                          }
                        }}
                        className={`w-full rounded px-1.5 py-0.5 text-xs font-semibold select-text focus:outline-none border ${
                          isDark
                            ? 'bg-neutral-900 border-violet-500 text-white'
                            : 'bg-white border-violet-500 text-slate-900'
                        }`}
                      />
                    ) : (
                      <span
                        className="truncate"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingReqId(req.id);
                          setEditingReqName(req.name || '');
                        }}
                        title="Double-click to rename request"
                      >
                        {req.name || 'Untitled'}
                      </span>
                    )}
                  </div>

                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingReqId(req.id);
                        setEditingReqName(req.name || '');
                      }}
                      className="p-1 text-neutral-500 hover:text-violet-400 transition"
                      title="Rename Request"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExportRequest(req);
                      }}
                      className="p-1 text-neutral-500 hover:text-emerald-400 transition"
                      title="Export Request as JSON (to ~/Downloads)"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRequest(req.id, collPath);
                      }}
                      className="p-1 text-neutral-500 hover:text-rose-400 transition"
                      title="Delete Request"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}

            {coll.requests.length === 0 && !hasSubfolders && creatingSubfolderFor !== collPath && (
              <div className="py-1.5 px-3 text-[11px] text-neutral-500 italic">
                Empty folder. Click <strong className="text-neutral-400 font-semibold">+</strong> to add request.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      style={{ width: `${sidebarWidth}px` }}
      className={`relative flex shrink-0 flex-col border-r select-none transition-colors duration-200 ${
        isDark ? 'border-neutral-800/80 bg-[#11131a]' : 'border-slate-200 bg-slate-50/90'
      }`}
    >
      {/* Draggable right-edge width resizer */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          isResizingRef.current = true;
          document.body.style.cursor = 'col-resize';
        }}
        title="Drag to resize sidebar width"
        className="absolute right-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize hover:bg-violet-500/40 transition-colors"
      />
      {/* 1. Explorer Header */}
      <div className={`flex items-center justify-between border-b px-3.5 py-3 ${
        isDark ? 'border-neutral-800/80' : 'border-slate-200'
      }`}>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-violet-500 shadow-sm shadow-violet-500/50" />
          <span className={`text-xs font-black uppercase tracking-wider ${isDark ? 'text-neutral-300' : 'text-slate-800'}`}>
            Collections
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenImport}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition shadow-2xs ${
              isDark
                ? 'border-neutral-800 bg-neutral-900/90 text-neutral-300 hover:bg-neutral-800 hover:text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            title="Import Collection / OpenAPI v2 & v3 / CSV / cURL"
          >
            <Upload className="h-3 w-3 text-indigo-400" />
            <span>Import</span>
          </button>
          <button
            onClick={() => setIsCreatingColl(true)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition shadow-2xs ${
              isDark
                ? 'border-neutral-800 bg-neutral-900/90 text-neutral-300 hover:bg-neutral-800 hover:text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
            title="Create New Folder"
          >
            <FolderPlus className="h-3 w-3 text-amber-400" />
            <span>Folder</span>
          </button>
        </div>
      </div>

      {/* 2. Search Filter */}
      <div className={`border-b p-2.5 ${isDark ? 'border-neutral-800/60' : 'border-slate-200'}`}>
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition ${
          isDark
            ? 'border-neutral-800 bg-neutral-950/90 focus-within:border-violet-500/50'
            : 'border-slate-300 bg-white focus-within:border-violet-500 shadow-2xs'
        }`}>
          <Search className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter requests..."
            className={`w-full bg-transparent text-xs font-medium focus:outline-none ${
              isDark ? 'text-neutral-100 placeholder-neutral-500' : 'text-slate-900 placeholder-slate-400'
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[10px] text-neutral-400 hover:text-white px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 3. New Collection Inline Form */}
      {isCreatingColl && (
        <form
          onSubmit={handleCreateSubmit}
          className={`border-b p-2 flex items-center gap-1.5 transition ${
            isDark ? 'border-neutral-800 bg-neutral-950/90' : 'border-slate-200 bg-white'
          }`}
        >
          <input
            type="text"
            autoFocus
            value={newCollName}
            onChange={(e) => setNewCollName(e.target.value)}
            placeholder="Collection name..."
            className={`flex-1 rounded-lg border px-2.5 py-1 text-xs focus:outline-none ${
              isDark
                ? 'border-neutral-700 bg-neutral-900 text-neutral-100 focus:border-violet-500'
                : 'border-slate-300 bg-slate-50 text-neutral-900 focus:border-violet-500'
            }`}
          />
          <button
            type="submit"
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${accentDef.buttonClass}`}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingColl(false)}
            className="rounded px-2 py-1 text-[11px] text-neutral-400 hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* 4. Collections & Nested Folders Tree */}
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-1.5">
        {filteredCollections.map((coll) => renderCollectionNode(coll, 0))}

        {filteredCollections.length === 0 && (
          <div className="p-6 text-center text-xs text-neutral-500 italic">
            {searchQuery ? 'No matching requests found.' : 'No collections yet. Click "+ Folder" to create one.'}
          </div>
        )}
      </div>
      {/* Delete Collection Confirmation Modal */}
      {collToDelete && (
        <div 
          onClick={() => setCollToDelete(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl transition-all ${
              isDark ? 'border-neutral-800 bg-[#161924] text-white' : 'border-slate-300 bg-white text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-500">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black">Delete Collection</h3>
                <p className="text-[11px] text-neutral-400">This action cannot be undone</p>
              </div>
            </div>

            <p className={`text-xs leading-relaxed mb-5 ${isDark ? 'text-neutral-300' : 'text-slate-600'}`}>
              Are you sure you want to permanently delete collection{' '}
              <strong className={`px-1.5 py-0.5 rounded font-mono font-bold ${
                isDark ? 'bg-neutral-800 text-white' : 'bg-slate-200 text-slate-900'
              }`}>
                {collToDelete.path || collToDelete.name}
              </strong>{' '}
              and all of its <span className="font-bold text-rose-500">{countRequestsRecursive(collToDelete)}</span> saved requests?
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCollToDelete(null)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition border cursor-pointer ${
                  isDark
                    ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
                    : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetPath = collToDelete.path || collToDelete.name;
                  setCollToDelete(null);
                  onDeleteCollection(targetPath);
                }}
                className="rounded-xl bg-rose-600 hover:bg-rose-500 px-3.5 py-1.5 text-xs font-black text-white shadow-md shadow-rose-600/30 transition-all hover:scale-105 cursor-pointer"
              >
                Delete Collection
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
