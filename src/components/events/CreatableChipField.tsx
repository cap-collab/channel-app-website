'use client';

import { useMemo, useState } from 'react';

/**
 * A single-field creatable-select picker, modeled on the field-notes
 * FieldNoteTagPicker: type to search `options`, pick a match, or commit free
 * text (on blur / Enter). Selections render as removable chips above the input.
 *
 * Generic over the option and selected shapes so each events field (Venue,
 * Collectives, DJs) keeps its own data shape. The caller supplies the label
 * extractors, dedupe keys, and the free-text → selection mapping.
 */
interface Props<Opt, Sel> {
  label: string;
  options: Opt[];
  selected: Sel[];
  /** Display label for an option row / chip. */
  optionLabel: (o: Opt) => string;
  selectedLabel: (s: Sel) => string;
  /** Dedupe keys: DB id when present, else a normalized name. */
  optionKey: (o: Opt) => string;
  selectedKey: (s: Sel) => string;
  /** Map a chosen option → a selection entry. */
  toSelected: (o: Opt) => Sel;
  /** Map committed free text → a selection entry (return null to reject). */
  freeTextToSelected: (text: string) => Sel | null;
  onChange: (next: Sel[]) => void;
  placeholder?: string;
  loading?: boolean;
}

export function CreatableChipField<Opt, Sel>({
  label,
  options,
  selected,
  optionLabel,
  selectedLabel,
  optionKey,
  selectedKey,
  toSelected,
  freeTextToSelected,
  onChange,
  placeholder,
  loading,
}: Props<Opt, Sel>) {
  const [query, setQuery] = useState('');

  const selectedKeys = useMemo(() => new Set(selected.map(selectedKey)), [selected, selectedKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Opt[];
    return options
      .filter((o) => optionLabel(o).toLowerCase().includes(q) && !selectedKeys.has(optionKey(o)))
      .slice(0, 8);
  }, [query, options, selectedKeys, optionLabel, optionKey]);

  const addOption = (o: Opt) => {
    if (selectedKeys.has(optionKey(o))) return;
    onChange([...selected, toSelected(o)]);
    setQuery('');
  };

  const addFreeText = () => {
    const name = query.trim();
    if (!name) return;
    const entry = freeTextToSelected(name);
    if (!entry || selectedKeys.has(selectedKey(entry))) return;
    onChange([...selected, entry]);
    setQuery('');
  };

  const remove = (key: string) => {
    onChange(selected.filter((s) => selectedKey(s) !== key));
  };

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selected.map((s) => (
            <span
              key={selectedKey(s)}
              className="inline-flex items-center gap-1 rounded-full bg-[#333] text-white text-sm px-3 py-1"
            >
              {selectedLabel(s)}
              <button
                type="button"
                onClick={() => remove(selectedKey(s))}
                className="text-gray-400 hover:text-white leading-none"
                aria-label={`Remove ${selectedLabel(s)}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={addFreeText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered.length > 0) addOption(filtered[0]);
            else addFreeText();
          }
        }}
        placeholder={loading ? 'Loading…' : placeholder}
        className="w-full bg-[#252525] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-white"
      />
      {filtered.length > 0 && (
        <div className="mt-1 rounded-lg bg-[#252525] border border-gray-700 divide-y divide-white/10 overflow-hidden">
          {filtered.map((o) => (
            <button
              key={optionKey(o)}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addOption(o)}
              className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-[#333]"
            >
              {optionLabel(o)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
