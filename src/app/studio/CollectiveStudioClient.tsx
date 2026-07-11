"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthContext } from "@/contexts/AuthContext";
import { Header } from "@/components/Header";
import { normalizeUrl } from "@/lib/url";
import { parseGenresInput, extractInstagramHandle } from "@/lib/genres";
import { uploadCollectivePhoto, validatePhoto } from "@/lib/photo-upload";
import { Checkbox } from "@/components/Checkbox";
import { ResidentsPicker } from "@/components/studio/ResidentsPicker";
import { CollectiveEventsCard } from "@/components/studio/CollectiveEventsCard";
import type { CustomLink, EventDJRef } from "@/types/events";

// Collective studio — a trimmed clone of StudioProfileClient's cosmetic cards,
// writing to collectives/{id} instead of users/{uid}. Cosmetic fields
// (photo/description/location/genres/socialLinks/tipButtonLink) are direct
// client updateDoc calls gated by the firestore cosmetic-owner rule. Residents,
// guests, and IRL shows go through owner-authorized API routes (wired in later).
//
// Owner access + the collective this studio edits are resolved from the caller's
// ownedCollectiveSlugs (the single source of truth). Terms acceptance
// (collectiveTermsAcceptedAt) actively gates entry — an owner who hasn't accepted
// sees the terms screen first.

interface CollectiveDoc {
  id: string;
  name: string;
  slug: string;
  photo?: string | null;
  location?: string | null;
  description?: string | null;
  genres?: string[];
  socialLinks?: {
    instagram?: string | null;
    soundcloud?: string | null;
    bandcamp?: string | null;
    youtube?: string | null;
    mixcloud?: string | null;
    email?: string | null;
    website?: string | null;
    residentAdvisor?: string | null;
    customLinks?: CustomLink[] | null;
  };
  tipButtonLink?: string | null;
  residentDJs?: EventDJRef[];
  guestDJs?: EventDJRef[];
}

interface Props {
  // The collective slug this studio manages (first owned slug; multi-collective
  // deferred). Passed by /studio routing.
  slug: string;
  // When true, this studio is embedded inside /studio for a DJ who ALSO owns a
  // collective — show a "back to your artist page" affordance handled by parent.
  onExit?: () => void;
}

export default function CollectiveStudioClient({ slug, onExit }: Props) {
  const { user, loading: authLoading } = useAuthContext();

  const [collective, setCollective] = useState<CollectiveDoc | null>(null);
  const [loadingCollective, setLoadingCollective] = useState(true);
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<unknown>(undefined);
  const [loadingTerms, setLoadingTerms] = useState(true);

  // Cosmetic form state
  const [bioInput, setBioInput] = useState("");
  const [savingAbout, setSavingAbout] = useState(false);
  const [saveAboutSuccess, setSaveAboutSuccess] = useState(false);

  const [locationInput, setLocationInput] = useState("");
  const [genresInput, setGenresInput] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [saveDetailsSuccess, setSaveDetailsSuccess] = useState(false);

  const [instagramInput, setInstagramInput] = useState("");
  const [soundcloudInput, setSoundcloudInput] = useState("");
  const [bandcampInput, setBandcampInput] = useState("");
  const [youtubeInput, setYoutubeInput] = useState("");
  const [mixcloudInput, setMixcloudInput] = useState("");
  const [residentAdvisorInput, setResidentAdvisorInput] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [savingSocial, setSavingSocial] = useState(false);
  const [saveSocialSuccess, setSaveSocialSuccess] = useState(false);

  const [tipButtonLinkInput, setTipButtonLinkInput] = useState("");
  const [savingTip, setSavingTip] = useState(false);
  const [saveTipSuccess, setSaveTipSuccess] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);

  const bioDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);

  // Subscribe to this user's doc for terms-acceptance (gates entry).
  useEffect(() => {
    if (!user || !db) {
      setLoadingTerms(false);
      return;
    }
    const unsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
      const data = snap.data();
      setTermsAcceptedAt(data?.collectiveTermsAcceptedAt ?? null);
      setLoadingTerms(false);
    });
    return () => unsub();
  }, [user]);

  // Resolve + subscribe to the collective doc by slug.
  useEffect(() => {
    if (!db || !slug) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const q = query(collection(db, "collectives"), where("slug", "==", slug), limit(1));
      const snap = await getDocs(q);
      if (cancelled) return;
      if (snap.empty) {
        setLoadingCollective(false);
        return;
      }
      const ref = snap.docs[0].ref;
      unsub = onSnapshot(ref, (docSnap) => {
        const d = docSnap.data();
        if (!d) return;
        const c: CollectiveDoc = { id: docSnap.id, name: d.name, slug: d.slug, ...d };
        setCollective(c);
        setLoadingCollective(false);
        // Hydrate form inputs once (don't clobber in-flight edits on later snapshots).
        if (!hydratedRef.current) {
          hydratedRef.current = true;
          setBioInput(d.description || "");
          setLocationInput(d.location || "");
          setGenresInput(Array.isArray(d.genres) ? d.genres.join(", ") : "");
          const s = d.socialLinks || {};
          setInstagramInput(s.instagram || "");
          setSoundcloudInput(s.soundcloud || "");
          setBandcampInput(s.bandcamp || "");
          setYoutubeInput(s.youtube || "");
          setMixcloudInput(s.mixcloud || "");
          setResidentAdvisorInput(s.residentAdvisor || "");
          setWebsiteInput(s.website || "");
          setEmailInput(s.email || "");
          setTipButtonLinkInput(d.tipButtonLink || "");
        }
      });
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [slug]);

  const collectiveRef = useCallback(() => {
    if (!db || !collective) return null;
    return doc(db, "collectives", collective.id);
  }, [collective]);

  // --- Cosmetic saves (direct writes, cosmetic-only per firestore rule) ---

  const saveAbout = useCallback(async (description: string) => {
    const ref = collectiveRef();
    if (!ref) return;
    setSavingAbout(true);
    setSaveAboutSuccess(false);
    try {
      await updateDoc(ref, { description: description.trim() || null });
      setSaveAboutSuccess(true);
      setTimeout(() => setSaveAboutSuccess(false), 2000);
    } catch (e) {
      console.error("Error saving description:", e);
    } finally {
      setSavingAbout(false);
    }
  }, [collectiveRef]);

  const saveDetails = useCallback(async (location: string, genres: string) => {
    const ref = collectiveRef();
    if (!ref) return;
    setSavingDetails(true);
    setSaveDetailsSuccess(false);
    try {
      await updateDoc(ref, {
        location: location.trim() || null,
        genres: parseGenresInput(genres),
      });
      setSaveDetailsSuccess(true);
      setTimeout(() => setSaveDetailsSuccess(false), 2000);
    } catch (e) {
      console.error("Error saving details:", e);
    } finally {
      setSavingDetails(false);
    }
  }, [collectiveRef]);

  const saveSocialLinks = useCallback(async () => {
    const ref = collectiveRef();
    if (!ref) return;
    setSavingSocial(true);
    setSaveSocialSuccess(false);
    try {
      await updateDoc(ref, {
        socialLinks: {
          instagram: instagramInput.trim() ? extractInstagramHandle(instagramInput) : null,
          soundcloud: soundcloudInput.trim() ? normalizeUrl(soundcloudInput.trim()) : null,
          bandcamp: bandcampInput.trim() ? normalizeUrl(bandcampInput.trim()) : null,
          youtube: youtubeInput.trim() ? normalizeUrl(youtubeInput.trim()) : null,
          mixcloud: mixcloudInput.trim() ? normalizeUrl(mixcloudInput.trim()) : null,
          residentAdvisor: residentAdvisorInput.trim() ? normalizeUrl(residentAdvisorInput.trim()) : null,
          website: websiteInput.trim() ? normalizeUrl(websiteInput.trim()) : null,
          // NOTE: collective socialLinks uses `email`, NOT `bookingEmail` (the DJ key).
          email: emailInput.trim() || null,
        },
      });
      setSaveSocialSuccess(true);
      setTimeout(() => setSaveSocialSuccess(false), 2000);
    } catch (e) {
      console.error("Error saving social links:", e);
    } finally {
      setSavingSocial(false);
    }
  }, [collectiveRef, instagramInput, soundcloudInput, bandcampInput, youtubeInput, mixcloudInput, residentAdvisorInput, websiteInput, emailInput]);

  const saveTip = useCallback(async (link: string) => {
    const ref = collectiveRef();
    if (!ref) return;
    setSavingTip(true);
    setSaveTipSuccess(false);
    try {
      await updateDoc(ref, { tipButtonLink: link.trim() ? normalizeUrl(link.trim()) : null });
      setSaveTipSuccess(true);
      setTimeout(() => setSaveTipSuccess(false), 2000);
    } catch (e) {
      console.error("Error saving tip link:", e);
    } finally {
      setSavingTip(false);
    }
  }, [collectiveRef]);

  // Debounced auto-save for bio + details (mirrors DJ studio: 1s delay).
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (bioDebounceRef.current) clearTimeout(bioDebounceRef.current);
    bioDebounceRef.current = setTimeout(() => saveAbout(bioInput), 1000);
    return () => { if (bioDebounceRef.current) clearTimeout(bioDebounceRef.current); };
  }, [bioInput, saveAbout]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current);
    detailsDebounceRef.current = setTimeout(() => saveDetails(locationInput, genresInput), 1000);
    return () => { if (detailsDebounceRef.current) clearTimeout(detailsDebounceRef.current); };
  }, [locationInput, genresInput, saveDetails]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !collective) return;
    setPhotoError(null);
    const validation = validatePhoto(file);
    if (!validation.valid) {
      setPhotoError(validation.error || "Invalid file");
      return;
    }
    setUploadingPhoto(true);
    try {
      const result = await uploadCollectivePhoto(collective.id, file);
      if (!result.success) {
        setPhotoError(result.error || "Upload failed");
        return;
      }
      const ref = collectiveRef();
      if (ref) await updateDoc(ref, { photo: result.url });
    } catch (err) {
      console.error("Error uploading photo:", err);
      setPhotoError("Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleAcceptTerms = async () => {
    if (!user || !db || !agreedToTerms) return;
    setAcceptingTerms(true);
    try {
      // Direct write to own user doc — allowed by the users/{uid} self-write rule.
      const { serverTimestamp } = await import("firebase/firestore");
      await updateDoc(doc(db, "users", user.uid), {
        collectiveTermsAcceptedAt: serverTimestamp(),
      });
      // onSnapshot will flip termsAcceptedAt and re-render into the studio.
    } catch (e) {
      console.error("Error accepting collective terms:", e);
    } finally {
      setAcceptingTerms(false);
    }
  };

  // --- Render gates ---

  if (authLoading || loadingTerms || loadingCollective) {
    return (
      <div className="min-h-screen bg-black">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!collective) {
    return (
      <div className="min-h-screen bg-black">
        <Header />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-400">Collective not found.</p>
        </div>
      </div>
    );
  }

  // Terms gate — must accept before managing the collective.
  if (!termsAcceptedAt) {
    return (
      <div className="min-h-screen bg-black">
        <Header />
        <div className="max-w-lg mx-auto px-4 py-16">
          <h1 className="text-2xl font-bold text-white mb-2">Manage {collective.name}</h1>
          <p className="text-gray-400 text-sm mb-6">
            Before you can manage this collective&apos;s page, please review and accept the
            Collective Terms.
          </p>
          <div className="bg-[#1e1e1e] rounded p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox checked={agreedToTerms} onChange={setAgreedToTerms} />
              <span className="text-gray-300 text-sm">
                I confirm that I have authority to manage this collective and agree to the{" "}
                <Link href="/collective-terms" target="_blank" className="text-blue-400 hover:text-blue-300 underline">
                  Collective Terms
                </Link>
                .
              </span>
            </label>
            <button
              onClick={handleAcceptTerms}
              disabled={!agreedToTerms || acceptingTerms}
              className="mt-4 w-full bg-white text-black py-3 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {acceptingTerms ? "Saving..." : "Accept & manage collective"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Studio body ---
  return (
    <div className="min-h-screen bg-black">
      <Header />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wide">Collective Studio</p>
            <h1 className="text-2xl font-bold text-white">{collective.name}</h1>
            <Link
              href={`/dj/${collective.slug}`}
              className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
            >
              /dj/{collective.slug} &rarr;
            </Link>
          </div>
          {onExit && (
            <button
              onClick={onExit}
              className="text-gray-400 hover:text-white text-sm transition-colors border border-gray-700 rounded px-3 py-1.5"
            >
              Manage your artist page
            </button>
          )}
        </div>

        {/* Profile Photo */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3">Collective Photo</h2>
          <div className="bg-[#1e1e1e] rounded p-4">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 flex-shrink-0">
                {collective.photo ? (
                  <Image src={collective.photo} alt="Collective photo" fill className="rounded-full object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gray-800 flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                )}
                {uploadingPhoto && (
                  <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <label className="block">
                  <span className="sr-only">Choose photo</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handlePhotoChange}
                    disabled={uploadingPhoto}
                    className="block w-full text-sm text-gray-400
                      file:mr-4 file:py-2 file:px-4
                      file:rounded file:border-0
                      file:text-sm file:font-medium
                      file:bg-white file:text-black
                      file:cursor-pointer file:hover:bg-gray-100
                      file:disabled:opacity-50 file:disabled:cursor-not-allowed
                      cursor-pointer"
                  />
                </label>
              </div>
            </div>
            {photoError && <p className="text-red-400 text-xs mt-3">{photoError}</p>}
          </div>
        </section>

        {/* Description */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">About</h2>
          <p className="text-gray-500 text-xs mb-3 px-1">
            This description appears on the collective&apos;s public page.
          </p>
          <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Description</label>
              <textarea
                value={bioInput}
                onChange={(e) => setBioInput(e.target.value)}
                placeholder="Tell listeners about the collective..."
                rows={3}
                maxLength={500}
                className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none resize-none"
              />
              <div className="flex justify-between items-center mt-1">
                <span className="text-gray-500 text-xs">
                  {savingAbout ? "Saving..." : saveAboutSuccess ? "Saved" : ""}
                </span>
                <span className="text-gray-500 text-xs">{bioInput.length}/500</span>
              </div>
            </div>
          </div>
        </section>

        {/* Details: location + genres */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-3">Details</h2>
          <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Location</label>
              <input
                type="text"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                placeholder="City, Country"
                className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-2">Genres</label>
              <input
                type="text"
                value={genresInput}
                onChange={(e) => setGenresInput(e.target.value)}
                placeholder="House, Techno, Disco (comma-separated)"
                className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
              />
            </div>
            <span className="text-gray-500 text-xs">
              {savingDetails ? "Saving..." : saveDetailsSuccess ? "Saved" : ""}
            </span>
          </div>
        </section>

        {/* Social Links */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">Social Links</h2>
          <p className="text-gray-500 text-xs mb-3 px-1">These links appear on the collective&apos;s public page.</p>
          <div className="bg-[#1e1e1e] rounded p-4 space-y-4">
            {[
              { label: "Instagram", value: instagramInput, set: setInstagramInput, ph: "@handle or instagram.com/handle" },
              { label: "SoundCloud", value: soundcloudInput, set: setSoundcloudInput, ph: "https://soundcloud.com/name" },
              { label: "Bandcamp", value: bandcampInput, set: setBandcampInput, ph: "https://name.bandcamp.com" },
              { label: "YouTube", value: youtubeInput, set: setYoutubeInput, ph: "https://youtube.com/@name" },
              { label: "Mixcloud", value: mixcloudInput, set: setMixcloudInput, ph: "https://mixcloud.com/name" },
              { label: "Resident Advisor", value: residentAdvisorInput, set: setResidentAdvisorInput, ph: "https://ra.co/..." },
              { label: "Website", value: websiteInput, set: setWebsiteInput, ph: "https://..." },
            ].map((f) => (
              <div key={f.label}>
                <label className="block text-gray-400 text-sm mb-2">{f.label}</label>
                <input
                  type="text"
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder={f.ph}
                  className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
                />
              </div>
            ))}
            <div>
              <label className="block text-gray-400 text-sm mb-2">Contact Email</label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="hello@collective.com"
                className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">{saveSocialSuccess ? "Saved" : ""}</span>
              <button
                onClick={saveSocialLinks}
                disabled={savingSocial}
                className="bg-white text-black text-sm px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {savingSocial ? "Saving..." : "Save links"}
              </button>
            </div>
          </div>
        </section>

        {/* Tip button */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">Support Link</h2>
          <p className="text-gray-500 text-xs mb-3 px-1">A support/tip button on the public page (optional).</p>
          <div className="bg-[#1e1e1e] rounded p-4 space-y-3">
            <input
              type="text"
              value={tipButtonLinkInput}
              onChange={(e) => setTipButtonLinkInput(e.target.value)}
              placeholder="https://..."
              className="w-full bg-black border border-gray-800 rounded px-3 py-2 text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs">{saveTipSuccess ? "Saved" : ""}</span>
              <button
                onClick={() => saveTip(tipButtonLinkInput)}
                disabled={savingTip}
                className="bg-white text-black text-sm px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {savingTip ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </section>

        {/* Residents */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">Residents</h2>
          <p className="text-gray-500 text-xs mb-3 px-1">
            DJs who are part of the collective. Link an existing Channel DJ, add a name, or create a profile.
          </p>
          <div className="bg-[#1e1e1e] rounded p-4">
            {user && (
              <ResidentsPicker
                slug={collective.slug}
                user={user}
                list="resident"
                items={collective.residentDJs || []}
                onChange={(next) => setCollective((c) => (c ? { ...c, residentDJs: next } : c))}
              />
            )}
          </div>
        </section>

        {/* Guests */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">Guests</h2>
          <p className="text-gray-500 text-xs mb-3 px-1">Guest DJs, shown separately from residents.</p>
          <div className="bg-[#1e1e1e] rounded p-4">
            {user && (
              <ResidentsPicker
                slug={collective.slug}
                user={user}
                list="guest"
                items={collective.guestDJs || []}
                onChange={(next) => setCollective((c) => (c ? { ...c, guestDJs: next } : c))}
              />
            )}
          </div>
        </section>

        {/* IRL events */}
        <section>
          <h2 className="text-gray-400 text-xs uppercase tracking-wide mb-1">Events</h2>
          <p className="text-gray-500 text-xs mb-3 px-1">Upcoming IRL events for the collective.</p>
          <div className="bg-[#1e1e1e] rounded p-4">
            {user && (
              <CollectiveEventsCard
                user={user}
                collectiveId={collective.id}
                collectiveName={collective.name}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
