import React, { useState, useEffect } from 'react';
import { Environment } from '../types';
import { useTheme } from '../context/ThemeContext';
import { X, Plus, Trash2, Check, Sliders } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  environments: Environment[];
  onSave: (envs: Environment[]) => void;
  onDeleteEnv: (id: string) => void;
  activeEnvId: string;
  onSelectEnv: (id: string) => void;
}

interface VarRow {
  rowId: string;
  key: string;
  value: string;
}

const recordToRows = (vars: Record<string, string> | undefined): VarRow[] =>
  Object.entries(vars || {}).map(([key, value], idx) => ({
    rowId: `row_${idx}_${key}`,
    key,
    value,
  }));

const rowsToRecord = (rows: VarRow[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const trimmedKey = r.key.trim();
    if (trimmedKey) {
      out[trimmedKey] = r.value;
    }
  }
  return out;
};

export const EnvironmentModal: React.FC<Props> = ({
  isOpen,
  onClose,
  environments,
  onSave,
  onDeleteEnv,
  activeEnvId,
  onSelectEnv,
}) => {
  const { isDark, accentDef } = useTheme();
  const [envs, setEnvs] = useState<Environment[]>(environments);
  const [selectedId, setSelectedId] = useState<string>(activeEnvId || environments[0]?.id || '');
  const [varRows, setVarRows] = useState<VarRow[]>([]);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');

  // Re-sync local editing state when modal opens (without resetting inputs on every keystroke)
  useEffect(() => {
    if (isOpen) {
      setEnvs(environments);
      const nextSelected =
        (activeEnvId && environments.some((e) => e.id === activeEnvId) ? activeEnvId : '') ||
        environments[0]?.id ||
        '';
      setSelectedId(nextSelected);
      const activeObj = environments.find((e) => e.id === nextSelected);
      setVarRows(recordToRows(activeObj?.variables));
      setNewVarKey('');
      setNewVarValue('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentEnv = envs.find((e) => e.id === selectedId) || envs[0];

  const handleSelectInModal = (envId: string) => {
    setSelectedId(envId);
    const target = envs.find((e) => e.id === envId);
    setVarRows(recordToRows(target?.variables));
    setNewVarKey('');
    setNewVarValue('');
  };

  const commitRows = (updatedRows: VarRow[], targetEnvId?: string) => {
    const envId = targetEnvId || currentEnv?.id;
    if (!envId) return;
    setVarRows(updatedRows);
    const nextVars = rowsToRecord(updatedRows);
    const updatedEnvs = envs.map((e) =>
      e.id === envId ? { ...e, variables: nextVars } : e
    );
    setEnvs(updatedEnvs);
    onSave(updatedEnvs);
  };

  const addEnvironment = () => {
    const newEnv: Environment = {
      id: `env_${Date.now()}`,
      name: `Environment ${envs.length + 1}`,
      variables: { baseUrl: 'http://localhost:8090' },
    };
    const updated = [...envs, newEnv];
    setEnvs(updated);
    setSelectedId(newEnv.id);
    setVarRows(recordToRows(newEnv.variables));
    onSave(updated);
    if (!activeEnvId) {
      onSelectEnv(newEnv.id);
    }
  };

  const deleteEnvironment = (id: string) => {
    const updated = envs.filter((e) => e.id !== id);
    setEnvs(updated);
    if (selectedId === id) {
      const fallback = updated[0];
      setSelectedId(fallback?.id || '');
      setVarRows(recordToRows(fallback?.variables));
    }
    onDeleteEnv(id);
  };

  const updateEnvName = (name: string) => {
    if (!currentEnv) return;
    const updated = envs.map((e) => (e.id === currentEnv.id ? { ...e, name } : e));
    setEnvs(updated);
    onSave(updated);
  };

  const handleRowChange = (rowId: string, field: 'key' | 'value', val: string) => {
    const nextRows = varRows.map((r) =>
      r.rowId === rowId ? { ...r, [field]: val } : r
    );
    setVarRows(nextRows);
    // Keep parent state synced live so switching tabs or clicking Done never loses edits
    if (currentEnv) {
      const nextVars = rowsToRecord(nextRows);
      const updatedEnvs = envs.map((e) =>
        e.id === currentEnv.id ? { ...e, variables: nextVars } : e
      );
      setEnvs(updatedEnvs);
    }
  };

  const handleAddVariable = () => {
    const k = newVarKey.trim();
    if (!k || !currentEnv) return;
    const existingIdx = varRows.findIndex((r) => r.key.trim() === k);
    let nextRows: VarRow[];
    if (existingIdx >= 0) {
      nextRows = varRows.map((r, i) => (i === existingIdx ? { ...r, value: newVarValue } : r));
    } else {
      nextRows = [...varRows, { rowId: `row_${Date.now()}_${k}`, key: k, value: newVarValue }];
    }
    setNewVarKey('');
    setNewVarValue('');
    commitRows(nextRows, currentEnv.id);
  };

  const handleDeleteVariable = (rowId: string) => {
    const nextRows = varRows.filter((r) => r.rowId !== rowId);
    commitRows(nextRows);
  };

  const handleDone = () => {
    if (currentEnv) {
      let rowsToSave = varRows;
      if (newVarKey.trim()) {
        rowsToSave = [
          ...varRows,
          { rowId: `row_${Date.now()}`, key: newVarKey.trim(), value: newVarValue },
        ];
      }
      commitRows(rowsToSave, currentEnv.id);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className={`flex h-[560px] w-[800px] flex-col rounded-2xl border shadow-2xl overflow-hidden ${
        isDark ? 'border-neutral-800 bg-neutral-900/95 text-neutral-100 shadow-neutral-950/80' : 'border-neutral-200 bg-white text-neutral-900 shadow-slate-300'
      }`}>
        {/* Modal Header */}
        <div className={`flex items-center justify-between border-b px-5 py-3.5 ${
          isDark ? 'border-neutral-800' : 'border-neutral-200 bg-slate-50'
        }`}>
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-indigo-400" />
            <h2 className="text-sm font-bold">Manage Environments &amp; Variables</h2>
          </div>
          <button
            onClick={handleDone}
            className={`rounded-lg p-1.5 transition cursor-pointer ${
              isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-slate-200'
            }`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Content Split Pane */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Environments Sidebar */}
          <div className={`w-60 border-r p-3.5 flex flex-col gap-2 ${
            isDark ? 'border-neutral-800 bg-neutral-950/40' : 'border-neutral-200 bg-slate-50/50'
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Environments</span>
              <button
                type="button"
                onClick={addEnvironment}
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition cursor-pointer ${accentDef.buttonClass}`}
                title="Create New Environment"
              >
                <Plus className="h-3 w-3" />
                <span>New</span>
              </button>
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto flex-1">
              {envs.map((env) => {
                const isSelected = currentEnv?.id === env.id;
                const isActive = activeEnvId === env.id;
                return (
                  <div
                    key={env.id}
                    onClick={() => handleSelectInModal(env.id)}
                    className={`group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer transition border ${
                      isSelected
                        ? `${accentDef.activeBorder} ${accentDef.badgeBg}`
                        : isDark
                          ? 'border-transparent text-neutral-400 hover:bg-neutral-800/60 hover:text-white'
                          : 'border-transparent text-neutral-600 hover:bg-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          isActive ? 'bg-emerald-400 shadow-sm shadow-emerald-400/70' : 'bg-neutral-600/40'
                        }`}
                        title={isActive ? 'Currently Active Environment' : 'Inactive'}
                      />
                      <span className="truncate">{env.name || 'Unnamed'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteEnvironment(env.id);
                      }}
                      className="opacity-70 group-hover:opacity-100 p-1 rounded text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer shrink-0"
                      title={`Delete "${env.name}"`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              {envs.length === 0 && (
                <div className="py-6 text-center text-xs text-neutral-500">
                  No environments. Click <strong>+ New</strong> to create one.
                </div>
              )}
            </div>
          </div>

          {/* Environment Variables Editor */}
          <div className="flex-1 p-5 flex flex-col gap-4 overflow-y-auto min-w-0">
            {currentEnv ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <input
                    type="text"
                    value={currentEnv.name}
                    onChange={(e) => updateEnvName(e.target.value)}
                    placeholder="Environment Name"
                    className={`flex-1 rounded-xl border px-3 py-1.5 text-sm font-bold focus:outline-none ${
                      isDark ? 'border-neutral-800 bg-neutral-950 text-white focus:border-violet-500' : 'border-neutral-300 bg-white text-neutral-900 focus:border-violet-500'
                    }`}
                  />
                  {activeEnvId === currentEnv.id ? (
                    <span className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 shrink-0">
                      <Check className="h-3.5 w-3.5" />
                      <span>Active</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectEnv(currentEnv.id)}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer shrink-0 ${accentDef.buttonClass}`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Set as Active</span>
                    </button>
                  )}
                </div>

                {/* Variables Table */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-neutral-400">
                    Variables available as <code className="text-indigo-400 font-mono">{"{{variableName}}"}</code> in URL, headers &amp; body
                  </span>

                  <div className={`rounded-xl border overflow-hidden ${
                    isDark ? 'border-neutral-800 bg-neutral-950/60' : 'border-neutral-200 bg-white shadow-xs'
                  }`}>
                    <table className="w-full text-left text-xs">
                      <thead className={`uppercase text-[10px] font-bold border-b ${
                        isDark ? 'bg-neutral-900 border-neutral-800 text-neutral-400' : 'bg-slate-100 border-neutral-200 text-neutral-600'
                      }`}>
                        <tr>
                          <th className="px-3.5 py-2 font-semibold w-2/5">Variable</th>
                          <th className="px-3.5 py-2 font-semibold">Current Value</th>
                          <th className="w-14 px-2 py-2 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${isDark ? 'divide-neutral-800/60' : 'divide-neutral-100'}`}>
                        {varRows.map((row) => (
                          <tr key={row.rowId}>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.key}
                                onChange={(e) => handleRowChange(row.rowId, 'key', e.target.value)}
                                onBlur={() => commitRows(varRows)}
                                placeholder="variable_name"
                                className={`w-full rounded-lg px-2 py-1 font-mono text-xs focus:outline-none ${
                                  isDark
                                    ? 'bg-neutral-900/60 text-indigo-300 focus:bg-neutral-900'
                                    : 'bg-slate-50 text-indigo-600 font-medium focus:bg-white'
                                }`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.value}
                                onChange={(e) => handleRowChange(row.rowId, 'value', e.target.value)}
                                onBlur={() => commitRows(varRows)}
                                placeholder="value"
                                className={`w-full rounded-lg px-2 py-1 font-mono text-xs focus:outline-none ${
                                  isDark
                                    ? 'bg-neutral-900/60 text-neutral-200 focus:bg-neutral-900'
                                    : 'bg-slate-50 text-neutral-800 focus:bg-white'
                                }`}
                              />
                            </td>
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteVariable(row.rowId)}
                                className="p-1 rounded text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                                title="Delete variable"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}

                        {/* Add Row */}
                        <tr className={isDark ? 'bg-neutral-900/30' : 'bg-slate-50/50'}>
                          <td className="p-2">
                            <input
                              type="text"
                              value={newVarKey}
                              onChange={(e) => setNewVarKey(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddVariable();
                              }}
                              placeholder="+ Variable name"
                              className={`w-full rounded-lg border px-2 py-1 font-mono text-xs focus:outline-none ${
                                isDark
                                  ? 'border-neutral-800 bg-neutral-950 text-neutral-200 placeholder-neutral-500 focus:border-violet-500'
                                  : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-violet-500'
                              }`}
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={newVarValue}
                              onChange={(e) => setNewVarValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddVariable();
                              }}
                              placeholder="Value (e.g. http://localhost:8090)"
                              className={`w-full rounded-lg border px-2 py-1 font-mono text-xs focus:outline-none ${
                                isDark
                                  ? 'border-neutral-800 bg-neutral-950 text-neutral-200 placeholder-neutral-500 focus:border-violet-500'
                                  : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-violet-500'
                              }`}
                            />
                          </td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={handleAddVariable}
                              disabled={!newVarKey.trim()}
                              className={`rounded-lg px-2 py-1 text-[11px] font-bold transition cursor-pointer disabled:opacity-40 ${accentDef.buttonClass}`}
                              title="Add Variable"
                            >
                              +
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-500 italic">
                No environment selected. Click + New to create one.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`flex justify-end border-t px-5 py-3 ${
          isDark ? 'border-neutral-800 bg-neutral-900/40' : 'border-neutral-200 bg-slate-50'
        }`}>
          <button
            type="button"
            onClick={handleDone}
            className={`rounded-xl px-4 py-1.5 text-xs font-semibold cursor-pointer ${accentDef.buttonClass}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
