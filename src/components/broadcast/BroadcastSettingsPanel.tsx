'use client';

import { useState } from 'react';
import { normalizeUrl } from '@/lib/url';

interface BroadcastSettingsPanelProps {
  broadcastToken: string;
  djUsername: string;
  userId?: string;
  promoText?: string;
  promoHyperlink?: string;
  thankYouMessage?: string;
  onPromoChange?: (text: string, hyperlink: string) => void;
  onThankYouChange?: (message: string) => void;
}

export function BroadcastSettingsPanel({
  broadcastToken,
  djUsername,
  userId,
  promoText = '',
  promoHyperlink = '',
  thankYouMessage = '',
  onPromoChange,
  onThankYouChange,
}: BroadcastSettingsPanelProps) {
  const [editingField, setEditingField] = useState<'promo' | 'thankYou' | null>(null);
  const [tempPromoText, setTempPromoText] = useState(promoText);
  const [tempPromoHyperlink, setTempPromoHyperlink] = useState(promoHyperlink);
  const [tempThankYou, setTempThankYou] = useState(thankYouMessage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSavePromo = async () => {
    setSaving(true);
    setError(null);

    try {
      const normalizedHyperlink = tempPromoHyperlink ? normalizeUrl(tempPromoHyperlink) : '';
      const response = await fetch('/api/broadcast/dj-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastToken,
          promoText: tempPromoText,
          promoHyperlink: normalizedHyperlink,
          username: djUsername,
        }),
      });

      if (response.ok) {
        onPromoChange?.(tempPromoText, normalizedHyperlink);
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
    setTempPromoText(promoText);
    setTempPromoHyperlink(promoHyperlink);
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
        {/* Promo */}
        {editingField === 'promo' ? (
          <div className="space-y-2">
            <label className="block text-gray-400 text-xs">Promo Text</label>
            <input
              type="text"
              value={tempPromoText}
              onChange={(e) => setTempPromoText(e.target.value)}
              placeholder="New album out now!"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
              maxLength={200}
            />
            <label className="block text-gray-400 text-xs">Promo Hyperlink (optional)</label>
            <input
              type="text"
              value={tempPromoHyperlink}
              onChange={(e) => setTempPromoHyperlink(e.target.value)}
              placeholder="bandcamp.com/your-album"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
            />
            <p className="text-gray-600 text-xs">Clicking the promo text will open this link</p>
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
                disabled={saving || !tempPromoText.trim()}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:bg-gray-700 text-white text-sm py-2 rounded-lg transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div
            onClick={() => {
              setTempPromoText(promoText);
              setTempPromoHyperlink(promoHyperlink);
              setEditingField('promo');
            }}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              <div className="min-w-0">
                <p className="text-gray-400 text-xs">Promo</p>
                {promoText ? (
                  <p className="text-white text-sm truncate">
                    {promoText}
                    {promoHyperlink && <span className="text-gray-500 ml-1">(linked)</span>}
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
