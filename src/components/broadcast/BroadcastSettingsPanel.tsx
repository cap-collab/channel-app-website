'use client';

import { useState } from 'react';
import { normalizeUrl } from '@/lib/url';

interface BroadcastSettingsPanelProps {
  broadcastToken: string;
  djUsername: string;
  promoText?: string;
  promoHyperlink?: string;
  onPromoChange?: (text: string, hyperlink: string) => void;
  tipButtonLink?: string;
  onTipButtonLinkChange?: (link: string) => void;
}

export function BroadcastSettingsPanel({
  broadcastToken,
  djUsername,
  promoText = '',
  promoHyperlink = '',
  onPromoChange,
  tipButtonLink = '',
  onTipButtonLinkChange,
}: BroadcastSettingsPanelProps) {
  const [editingField, setEditingField] = useState<'promo' | 'tipLink' | null>(null);
  const [tempPromoText, setTempPromoText] = useState(promoText);
  const [tempPromoHyperlink, setTempPromoHyperlink] = useState(promoHyperlink);
  const [tempTipLink, setTempTipLink] = useState(tipButtonLink);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSavePromo = async () => {
    setSaving(true);
    setError(null);

    try {
      const normalizedHyperlink = tempPromoHyperlink.trim() ? normalizeUrl(tempPromoHyperlink.trim()) : '';
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

  const handleSaveTipLink = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/broadcast/update-tip-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastToken,
          tipButtonLink: tempTipLink.trim(),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        onTipButtonLinkChange?.(data.tipButtonLink || '');
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
    setTempTipLink(tipButtonLink);
    setEditingField(null);
    setError(null);
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

        {/* Support Button Link */}
        {editingField === 'tipLink' ? (
          <div className="space-y-2">
            <label className="block text-gray-400 text-xs">Support Button Link</label>
            <input
              type="text"
              value={tempTipLink}
              onChange={(e) => setTempTipLink(e.target.value)}
              placeholder="https://ko-fi.com/yourname"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-500"
            />
            <p className="text-gray-600 text-xs">Where listeners go when they click the support button</p>
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={saving}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTipLink}
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
              setTempTipLink(tipButtonLink);
              setEditingField('tipLink');
            }}
            className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-800/50 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
              </svg>
              <div className="min-w-0">
                <p className="text-gray-400 text-xs">Support Link</p>
                {tipButtonLink ? (
                  <p className="text-white text-sm truncate">{tipButtonLink}</p>
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
