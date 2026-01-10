'use client';

import { useState } from 'react';
import { normalizeUrl } from '@/lib/url';

interface BroadcastSettingsPanelProps {
  broadcastToken: string;
  djUsername: string;
  userId?: string;
  promoUrl?: string;
  promoTitle?: string;
  thankYouMessage?: string;
  onPromoChange?: (url: string, title: string) => void;
  onThankYouChange?: (message: string) => void;
}

export function BroadcastSettingsPanel({
  broadcastToken,
  djUsername,
  userId,
  promoUrl = '',
  promoTitle = '',
  thankYouMessage = '',
  onPromoChange,
  onThankYouChange,
}: BroadcastSettingsPanelProps) {
  const [editingField, setEditingField] = useState<'promo' | 'thankYou' | null>(null);
  const [tempPromoUrl, setTempPromoUrl] = useState(promoUrl);
  const [tempPromoTitle, setTempPromoTitle] = useState(promoTitle);
  const [tempThankYou, setTempThankYou] = useState(thankYouMessage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSavePromo = async () => {
    setSaving(true);
    setError(null);

    try {
      const normalizedUrl = tempPromoUrl ? normalizeUrl(tempPromoUrl) : '';
      const response = await fetch('/api/broadcast/dj-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastToken,
          promoUrl: normalizedUrl,
          promoTitle: tempPromoTitle,
          username: djUsername,
        }),
      });

      if (response.ok) {
        onPromoChange?.(normalizedUrl, tempPromoTitle);
        setEditingField(null);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveThankYou = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/broadcast/update-thank-you', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastToken,
          thankYouMessage: tempThankYou,
          djUserId: userId,
        }),
      });

      if (response.ok) {
        onThankYouChange?.(tempThankYou);
        setEditingField(null);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTempPromoUrl(promoUrl);
    setTempPromoTitle(promoTitle);
    setTempThankYou(thankYouMessage);
    setEditingField(null);
    setError(null);
  };

  // Shorten URL for display
  const shortenUrl = (urlString: string): string => {
    if (!urlString) return '';
    try {
      const url = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
      let display = url.host;
      if (display.startsWith('www.')) {
        display = display.slice(4);
      }
      if (url.pathname && url.pathname !== '/') {
        display += url.pathname.slice(0, 20) + (url.pathname.length > 20 ? '...' : '');
      }
      return display;
    } catch {
      return urlString.slice(0, 30) + (urlString.length > 30 ? '...' : '');
    }
  };

  return (
    <div className="bg-[#252525] rounded-xl p-4">
      <h3 className="text-gray-400 text-sm font-medium mb-3">Customize Your Broadcast</h3>

      {error && (
        <div className="bg-red-900/50 text-red-200 text-sm px-3 py-2 rounded-lg mb-3">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {/* Promo Link */}
        {editingField === 'promo' ? (
          <div className="space-y-2">
            <label className="block text-gray-400 text-xs">Promo Link</label>
            <input
              type="text"
              value={tempPromoUrl}
              onChange={(e) => setTempPromoUrl(e.target.value)}
              placeholder="bandcamp.com/your-album"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
            />
            <input
              type="text"
              value={tempPromoTitle}
              onChange={(e) => setTempPromoTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
              maxLength={100}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePromo}
                disabled={saving}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-gray-700 text-white text-sm py-2 rounded-lg transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => {
              setTempPromoUrl(promoUrl);
              setTempPromoTitle(promoTitle);
              setEditingField('promo');
            }}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <div className="min-w-0">
                <p className="text-gray-400 text-xs">Promo Link</p>
                {promoUrl ? (
                  <p className="text-white text-sm truncate">
                    {promoTitle || shortenUrl(promoUrl)}
                  </p>
                ) : (
                  <p className="text-gray-600 text-sm">Not set</p>
                )}
              </div>
            </div>
            <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
        )}

        {/* Thank You Message */}
        {editingField === 'thankYou' ? (
          <div className="space-y-2">
            <label className="block text-gray-400 text-xs">Tip Thank You Message</label>
            <textarea
              value={tempThankYou}
              onChange={(e) => setTempThankYou(e.target.value.slice(0, 200))}
              placeholder="Thanks for the tip!"
              rows={2}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500 resize-none"
            />
            <p className="text-gray-600 text-xs">{tempThankYou.length}/200</p>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveThankYou}
                disabled={saving}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-gray-700 text-white text-sm py-2 rounded-lg transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => {
              setTempThankYou(thankYouMessage);
              setEditingField('thankYou');
            }}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-gray-500 flex-shrink-0">💸</span>
              <div className="min-w-0">
                <p className="text-gray-400 text-xs">Tip Thank You</p>
                {thankYouMessage ? (
                  <p className="text-white text-sm truncate">{thankYouMessage}</p>
                ) : (
                  <p className="text-gray-600 text-sm">Not set</p>
                )}
              </div>
            </div>
            <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
