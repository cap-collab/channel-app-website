'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { calculateTotalCharge } from '@/lib/stripe-client';

interface TipModalProps {
  isOpen: boolean;
  onClose: () => void;
  djUsername: string;
  djEmail: string;
  broadcastSlotId: string;
  showName: string;
  tipperUserId: string;
  tipperUsername: string;
}

const PRESET_AMOUNTS = [100, 300, 500, 1000]; // cents

export function TipModal({
  isOpen,
  onClose,
  djUsername,
  djEmail,
  broadcastSlotId,
  showName,
  tipperUserId,
  tipperUsername,
}: TipModalProps) {
  const [selectedAmount, setSelectedAmount] = useState(300); // $3 default
  const [isCustom, setIsCustom] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const currentAmount = isCustom ? (parseFloat(customAmount) * 100 || 0) : selectedAmount;
  const { tipAmountCents, platformFeeCents, totalCents } = calculateTotalCharge(currentAmount);

  const handlePresetClick = useCallback((amount: number) => {
    setSelectedAmount(amount);
    setIsCustom(false);
    setCustomAmount('');
  }, []);

  const handleCustomChange = useCallback((value: string) => {
    // Only allow numbers and one decimal point
    const cleaned = value.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1]?.length > 2) return;

    setCustomAmount(cleaned);
    setIsCustom(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (currentAmount < 100) {
      setError('Minimum tip is $1');
      return;
    }

    if (currentAmount > 50000) {
      setError('Maximum tip is $500');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/stripe/tip/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipAmountCents: currentAmount,
          djEmail,
          djUsername,
          broadcastSlotId,
          showName,
          tipperUserId,
          tipperUsername,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout');
      }

      // Redirect to Stripe Checkout
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsLoading(false);
    }
  }, [currentAmount, djEmail, djUsername, broadcastSlotId, showName, tipperUserId, tipperUsername]);

  if (!isOpen) return null;

  const isValidAmount = currentAmount >= 100 && currentAmount <= 50000;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[#1a1a1a] border border-white/20 rounded-xl p-6 w-full max-w-sm shadow-2xl my-auto">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-2xl mb-2">💸</div>
          <h2 className="text-lg font-medium text-white">Tip DJ {djUsername}</h2>
          <p className="text-sm text-gray-400 mt-1">{showName}</p>
        </div>

        {/* Preset amounts */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {PRESET_AMOUNTS.map((amount) => (
            <button
              key={amount}
              onClick={() => handlePresetClick(amount)}
              className={`py-2 rounded-lg text-sm font-medium transition-all ${
                selectedAmount === amount && !isCustom
                  ? 'bg-accent text-black'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              ${amount / 100}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="mb-6">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Enter amount"
              value={isCustom ? customAmount : (selectedAmount / 100).toString()}
              onChange={(e) => handleCustomChange(e.target.value)}
              onFocus={() => {
                if (!isCustom) {
                  // When focusing, convert current selection to custom input
                  setCustomAmount((selectedAmount / 100).toString());
                  setIsCustom(true);
                }
              }}
              className={`w-full pl-8 pr-4 py-3 bg-white/5 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all ${
                isCustom ? 'border-accent ring-1 ring-accent' : 'border-white/10'
              }`}
            />
          </div>
        </div>

        {/* Fee breakdown */}
        {isValidAmount && (
          <div className="mb-6 p-3 bg-white/5 rounded-lg text-sm">
            <div className="flex justify-between text-gray-400 mb-1">
              <span>Tip to DJ</span>
              <span>${(tipAmountCents / 100).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-400 mb-2">
              <span>Platform fee</span>
              <span>${(platformFeeCents / 100).toFixed(2)}</span>
            </div>
            <div className="border-t border-white/10 pt-2 flex justify-between text-white font-medium">
              <span>Total</span>
              <span>${(totalCents / 100).toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Terms agreement */}
        <div className="mb-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-white/5 text-accent focus:ring-accent focus:ring-offset-0"
            />
            <span className="text-sm text-gray-300">
              I agree to the{' '}
              <Link href="/terms" target="_blank" className="text-accent hover:underline">
                Terms of Use
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" className="text-accent hover:underline">
                Privacy Policy
              </Link>
            </span>
          </label>
          <p className="text-xs text-gray-500 mt-2 ml-7">
            Tips are voluntary and do not purchase content or services.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!isValidAmount || isLoading || !agreedToTerms}
          className={`w-full py-3 rounded-lg font-medium transition-all ${
            isValidAmount && !isLoading && agreedToTerms
              ? 'bg-accent text-black hover:bg-accent-hover'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isLoading ? 'Redirecting...' : `Send $${(tipAmountCents / 100).toFixed(2)} Tip`}
        </button>

        <p className="text-xs text-gray-500 text-center mt-4">
          Secure payment via Stripe
        </p>
      </div>
    </div>
  );
}
