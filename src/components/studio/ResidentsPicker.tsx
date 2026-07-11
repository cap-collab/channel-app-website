"use client";

import { useMemo, useState, useCallback } from "react";
import type { User } from "firebase/auth";
import { useTagOptions } from "@/hooks/useTagOptions";
import { normalizeUsername } from "@/lib/dj-matching";
import type { EventDJRef } from "@/types/events";

// Residents/Guests editor for the collective studio. Mirrors the /tape
// FieldNoteTagPicker: text entry with client-side auto-lookup over the shared
// DJ options (real + pending), free-text fallback (type a name → unlinked ref),
// first-match on Enter. The actual add/remove writes go through the
// owner-authorized /api/collective/[slug]/residents route.

interface Props {
  slug: string;
  user: User;
  list: "resident" | "guest";
  items: EventDJRef[];
  onChange: (next: EventDJRef[]) => void;
}

function Chip({ label, unlinked, onRemove }: { label: string; unlinked?: boolean; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700 text-white text-sm px-3 py-1">
      {label}
      {unlinked && <span className="text-zinc-400 text-xs">(text)</span>}
      <button
        type="button"
        onClick={onRemove}
        className="text-zinc-300 hover:text-white leading-none"
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}

export function ResidentsPicker({ slug, user, list, items, onChange }: Props) {
  const { djs: djOptions, loading } = useTagOptions();
  const [queryText, setQueryText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldKey = list === "guest" ? "guestDJs" : "residentDJs";
  const keyOf = (d: EventDJRef) => d.djUserId || d.djUsername || normalizeUsername(d.djName || "");
  const selectedKeys = useMemo(() => new Set(items.map(keyOf)), [items]);

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return [];
    return djOptions
      .filter((o) => o.label.toLowerCase().includes(q) && !selectedKeys.has(keyOf(o)))
      .slice(0, 8);
  }, [queryText, djOptions, selectedKeys]);

  const authHeaders = useCallback(async () => {
    const token = await user.getIdToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [user]);

  const post = useCallback(async (method: "POST" | "DELETE", entry: EventDJRef) => {
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/collective/${encodeURIComponent(slug)}/residents`, {
        method,
        headers,
        body: JSON.stringify({ list, entry }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        return;
      }
      onChange(data[fieldKey] || []);
    } catch {
      setError("Failed");
    } finally {
      setBusy(false);
    }
  }, [slug, list, fieldKey, authHeaders, onChange]);

  const addDj = (o: EventDJRef) => {
    if (selectedKeys.has(keyOf(o))) return;
    post("POST", { djName: o.djName, ...(o.djUserId ? { djUserId: o.djUserId } : {}), ...(o.djUsername ? { djUsername: o.djUsername } : {}), ...(o.djPhotoUrl ? { djPhotoUrl: o.djPhotoUrl } : {}) });
    setQueryText("");
  };
  const addFreeText = () => {
    const name = queryText.trim();
    if (!name || selectedKeys.has(normalizeUsername(name))) return;
    post("POST", { djName: name });
    setQueryText("");
  };
  const remove = (entry: EventDJRef) => post("DELETE", entry);

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-1">
          {items.map((d) => (
            <Chip key={keyOf(d)} label={d.djName} unlinked={!d.djUsername} onRemove={() => remove(d)} />
          ))}
        </div>
      )}
      <input
        type="text"
        value={queryText}
        onChange={(e) => setQueryText(e.target.value)}
        onBlur={addFreeText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (filtered.length > 0) addDj(filtered[0]);
            else addFreeText();
          }
        }}
        disabled={busy}
        placeholder={loading ? "Loading DJs…" : `Search a DJ, or type a new name`}
        className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none disabled:opacity-50"
      />
      {filtered.length > 0 && (
        <div className="rounded bg-[#1e1e1e] border border-gray-800 divide-y divide-white/10 overflow-hidden">
          {filtered.map((o) => (
            <button
              key={o.djUserId || o.djUsername || o.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addDj(o)}
              className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}
