"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { normalizeUrl } from "@/lib/url";
import { useTagOptions } from "@/hooks/useTagOptions";

// "TBA" venue = private / to-be-announced. Stored as an unlinked venue ref
// (venueName "TBA", no venueId) so it shows "TBA" publicly and links nowhere.
const TBA_VENUE = "TBA";

// IRL events editor for the collective studio. Events are docs in the `events`
// collection linked to this collective via linkedCollectives — created/edited
// through /api/events (owner-authorized; a collective owner may edit any event
// linked to a collective they own). Includes the discount-code field.

interface Props {
  user: User;
  collectiveId: string;
  collectiveName: string;
  collectiveSlug: string;
  collectivePhoto?: string | null;
  // Pre-fills the city field on a new event (the collective's location). Editable.
  defaultCity?: string | null;
}

interface VenueRef {
  venueId: string;
  venueName: string;
}

interface EventRow {
  id: string;
  name: string;
  date: number;
  location?: string | null;
  venue?: VenueRef | null;
  ticketLink?: string | null;
  discountCode?: string | null;
}

interface FormState {
  id?: string;
  name: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM, defaults to 20:00 (8 PM) like the DJ setup
  city: string; // free-text city → event.location
  venueName: string; // venue name (or "TBA") → linkedVenues
  venueId: string; // set when an existing venue was picked (else free text)
  ticketLink: string;
  discountCode: string;
}

const EMPTY_FORM: FormState = { name: "", date: "", startTime: "20:00", city: "", venueName: "", venueId: "", ticketLink: "", discountCode: "" };

// Compose date + start time into a unix-ms timestamp in the browser's LOCAL
// timezone (bare datetime string parses as local). Mirrors the DJ studio's
// eventDateMs so read-back and display line up.
function composeDateMs(date: string, startTime: string): number {
  return new Date(`${date}T${startTime || "20:00"}:00`).getTime();
}

export function CollectiveEventsCard({ user, collectiveId, collectiveName, collectiveSlug, collectivePhoto, defaultCity }: Props) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [venueFocused, setVenueFocused] = useState(false);

  const { venues: venueOptions } = useTagOptions();
  // Venue typeahead: "TBA" always offered first, then matching venues.
  const venueMatches = useMemo(() => {
    const q = form.venueName.trim().toLowerCase();
    const matches = venueOptions
      .filter((v) => v.label.toLowerCase().includes(q))
      .slice(0, 6);
    const tbaMatches = !q || TBA_VENUE.toLowerCase().includes(q);
    return { matches, showTba: tbaMatches };
  }, [form.venueName, venueOptions]);

  // A blank form pre-fills the city with the collective's city (editable).
  const freshForm = useCallback(
    (): FormState => ({ ...EMPTY_FORM, city: defaultCity || "" }),
    [defaultCity]
  );

  const loadEvents = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      // Events whose linkedCollectives includes this collective. Firestore can't
      // query array-of-objects directly, so read the linked events off the
      // collective + filter — but the simplest correct read is a scan filtered
      // in memory (events roster is small). Use the denormalized collectiveId
      // path first, then fall back to linkedCollectives membership.
      const snap = await getDocs(query(collection(db, "events"), where("date", ">", Date.now() - 86400000)));
      const rows: EventRow[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        const linked = Array.isArray(d.linkedCollectives) ? d.linkedCollectives : [];
        // Match on id OR slug, consistent with the events API's canEditEvent so
        // an owner never sees an event they can't edit (or vice versa).
        const isLinked =
          d.collectiveId === collectiveId ||
          d.collectiveSlug === collectiveSlug ||
          linked.some(
            (c: { collectiveId?: string; collectiveSlug?: string }) =>
              c.collectiveId === collectiveId || c.collectiveSlug === collectiveSlug
          );
        if (!isLinked) return;
        const firstVenue = Array.isArray(d.linkedVenues) && d.linkedVenues[0] ? d.linkedVenues[0] : null;
        rows.push({
          id: docSnap.id,
          name: d.name,
          date: d.date,
          location: d.location || null,
          venue: firstVenue ? { venueId: firstVenue.venueId || "", venueName: firstVenue.venueName || "" } : null,
          ticketLink: d.ticketLink || null,
          discountCode: d.discountCode || null,
        });
      });
      rows.sort((a, b) => a.date - b.date);
      setEvents(rows);
    } catch (e) {
      console.error("[CollectiveEventsCard] load failed", e);
    } finally {
      setLoading(false);
    }
  }, [collectiveId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const authHeaders = useCallback(async () => {
    const token = await user.getIdToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [user]);

  const startEdit = (ev: EventRow) => {
    // Read back in LOCAL time to match how composeDateMs stored it.
    const d = new Date(ev.date);
    const pad = (n: number) => String(n).padStart(2, "0");
    setForm({
      id: ev.id,
      name: ev.name,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      startTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      city: ev.location || "",
      venueName: ev.venue?.venueName || "",
      venueId: ev.venue?.venueId || "",
      ticketLink: ev.ticketLink || "",
      discountCode: ev.discountCode || "",
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.date) {
      setError("Name and date are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const headers = await authHeaders();
      // Auto-tag this collective on the event (full ref so the public event card
      // can link back to /dj/<slug> and show the photo).
      const linkedCollectives = [{
        collectiveId,
        collectiveName,
        collectiveSlug,
        collectivePhoto: collectivePhoto || null,
      }];
      // Venue → linkedVenues. A picked existing venue keeps its id; a typed name
      // (incl. "TBA") is stored unlinked (empty id) so it shows as text / TBA.
      const linkedVenues = form.venueName.trim()
        ? [{ venueId: form.venueId || "", venueName: form.venueName.trim() }]
        : [];
      const payload = {
        name: form.name.trim(),
        // Send a composed unix-ms timestamp (date + start time, default 8 PM).
        date: composeDateMs(form.date, form.startTime),
        location: form.city.trim() || undefined,
        linkedVenues,
        ticketLink: form.ticketLink.trim() ? normalizeUrl(form.ticketLink.trim()) : undefined,
        discountCode: form.discountCode.trim() || undefined,
        linkedCollectives,
      };
      const res = await fetch("/api/events", {
        method: form.id ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(form.id ? { ...payload, eventId: form.id } : payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save event");
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadEvents();
    } catch {
      setError("Failed to save event");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/events?eventId=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to remove event");
        return;
      }
      await loadEvents();
    } catch {
      setError("Failed to remove event");
    }
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      ) : events.length > 0 ? (
        <div className="divide-y divide-gray-700/50">
          {events.map((ev) => (
            <div key={ev.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-white text-sm truncate">{ev.name}</p>
                <p className="text-gray-500 text-xs">
                  {new Date(ev.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {" · "}
                  {new Date(ev.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  {ev.venue?.venueName ? ` · ${ev.venue.venueName}` : ev.location ? ` · ${ev.location}` : ""}
                  {ev.discountCode ? ` · code: ${ev.discountCode}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => startEdit(ev)} className="text-gray-400 hover:text-white text-xs">Edit</button>
                <button onClick={() => remove(ev.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-sm">No upcoming events yet.</p>
      )}

      {showForm ? (
        <div className="space-y-3 border-t border-gray-700/50 pt-3">
          <div>
            <label className="block text-gray-400 text-xs mb-1">Event name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Event name"
              className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <div>
              <label className="block text-gray-400 text-xs mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-40 bg-black border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1">Time</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                className="w-28 bg-black border border-gray-800 rounded px-3 py-2 text-white focus:border-gray-600 focus:outline-none [color-scheme:dark]"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">City</label>
            <input
              type="text"
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="City"
              className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Venue</label>
            <div className="relative">
              <input
                type="text"
                value={form.venueName}
                onChange={(e) => setForm((f) => ({ ...f, venueName: e.target.value, venueId: "" }))}
                onFocus={() => setVenueFocused(true)}
                onBlur={() => setTimeout(() => setVenueFocused(false), 150)}
                placeholder="Search a venue, type a name, or TBA"
                className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
              />
              {venueFocused && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded bg-[#1e1e1e] border border-gray-800 divide-y divide-white/10 overflow-hidden">
                  {venueMatches.showTba && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setForm((f) => ({ ...f, venueName: TBA_VENUE, venueId: "" })); setVenueFocused(false); }}
                      className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
                    >
                      TBA <span className="text-gray-500 text-xs">· venue kept private</span>
                    </button>
                  )}
                  {venueMatches.matches.map((v) => (
                    <button
                      key={v.venueId}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setForm((f) => ({ ...f, venueName: v.venueName, venueId: v.venueId })); setVenueFocused(false); }}
                      className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-zinc-700"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Ticket URL</label>
            <input
              type="text"
              value={form.ticketLink}
              onChange={(e) => setForm((f) => ({ ...f, ticketLink: e.target.value }))}
              placeholder="https://... (optional)"
              className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-xs mb-1">Discount code</label>
            <input
              type="text"
              value={form.discountCode}
              onChange={(e) => setForm((f) => ({ ...f, discountCode: e.target.value }))}
              placeholder="e.g. CHANNEL20 (optional)"
              className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="bg-white text-black text-sm px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : form.id ? "Save event" : "Add event"}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(freshForm()); setError(null); }}
              className="text-gray-400 hover:text-white text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setForm(freshForm()); setShowForm(true); }}
          className="text-blue-400 hover:text-blue-300 text-sm"
        >
          + Add an event
        </button>
      )}
    </div>
  );
}
