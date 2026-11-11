import React from 'react';
import { Environment, KeyValueItem } from '../types';
import { useTheme } from '../context/ThemeContext';
import { Trash2, Plus } from 'lucide-react';
import { EnvVarInput } from './EnvVarInput';

interface Props {
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  activeEnv?: Environment;
}

export const KeyValueTable: React.FC<Props> = ({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  activeEnv,
}) => {
  const { isDark } = useTheme();

  const updateItem = (index: number, field: keyof KeyValueItem, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index);
    onChange(updated);
  };

  const addItem = () => {
    onChange([...items, { key: '', value: '', enabled: true }]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className={`overflow-x-auto rounded-xl border shadow-xs ${
        isDark ? 'border-neutral-800 bg-neutral-900/40' : 'border-neutral-200 bg-white'
      }`}>
        <table className="w-full text-left text-xs">
          <thead className={`uppercase text-[10px] tracking-wider font-bold border-b ${
            isDark ? 'bg-neutral-900 border-neutral-800 text-neutral-400' : 'bg-slate-100 border-neutral-200 text-neutral-600'
          }`}>
            <tr>
              <th className="w-10 px-3 py-2 text-center">Use</th>
              <th className="px-3 py-2 font-semibold">{keyPlaceholder}</th>
              <th className="px-3 py-2 font-semibold">{valuePlaceholder}</th>
              <th className="w-12 px-3 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isDark ? 'divide-neutral-800/60' : 'divide-neutral-100'}`}>
            {items.map((item, index) => (
              <tr key={index} className={`transition ${isDark ? 'hover:bg-neutral-800/30' : 'hover:bg-slate-50'}`}>
                <td className="px-3 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => updateItem(index, 'enabled', e.target.checked)}
                    className="h-4 w-4 rounded cursor-pointer accent-indigo-500"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <EnvVarInput
                    value={item.key}
                    placeholder={keyPlaceholder}
                    onChange={(val) => updateItem(index, 'key', val)}
                    activeEnv={activeEnv}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <EnvVarInput
                    value={item.value}
                    placeholder={valuePlaceholder}
                    onChange={(val) => updateItem(index, 'value', val)}
                    activeEnv={activeEnv}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <button
                    onClick={() => removeItem(index)}
                    className="rounded p-1 text-neutral-500 hover:text-rose-400 transition"
                    title="Remove item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-xs text-neutral-500 italic">
                  No entries defined yet. Click &quot;Add Row&quot; below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        onClick={addItem}
        className={`flex items-center gap-1.5 self-start rounded-lg border px-3 py-1 text-xs font-semibold transition ${
          isDark
            ? 'border-neutral-800 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-white'
            : 'border-neutral-200 bg-slate-50 text-neutral-700 hover:bg-slate-100'
        }`}
      >
        <Plus className="h-3.5 w-3.5 text-indigo-400" />
        <span>Add Row</span>
      </button>
    </div>
  );
};
