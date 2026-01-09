'use client';

import { useState } from 'react';
import { Header } from '@/components/Header';

export function StripeSetupClient() {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['intro']));

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-black">
      <Header currentPage="stripe-setup" position="sticky" />

      <main className="p-4 md:p-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-4">Set up Stripe to receive support on Channel</h1>
            <p className="text-gray-400 leading-relaxed">
              Stripe requires basic information to verify who it is paying.
            </p>
          </div>

          {/* Disclaimer */}
          <div className="mb-8 p-4 bg-[#1a1a1a] border border-gray-800 rounded-xl">
            <p className="text-gray-400 text-sm leading-relaxed">
              The guidance below is illustrative only and reflects a setup commonly used by independent DJs. It is provided to help complete onboarding and does not constitute legal, tax, or accounting advice. You are responsible for ensuring the information you submit is accurate and appropriate for your situation.
            </p>
          </div>

          {/* Sections */}
          <div className="space-y-4">
            {/* Account Type */}
            <AccordionSection
              id="account-type"
              title="Account type"
              isOpen={openSections.has('account-type')}
              onToggle={() => toggleSection('account-type')}
            >
              <div className="space-y-4">
                <p className="text-gray-400">
                  When Stripe asks what type of account you&apos;re creating:
                </p>
                <div className="bg-[#252525] rounded-lg p-4">
                  <p className="text-white font-medium">Select: Individual</p>
                </div>
                <ul className="text-gray-400 space-y-2 list-disc list-inside">
                  <li>Use your real legal name (as on your ID)</li>
                  <li>Your DJ name is what appears on Channel</li>
                </ul>
              </div>
            </AccordionSection>

            {/* Business Information */}
            <AccordionSection
              id="business-info"
              title="Business information"
              isOpen={openSections.has('business-info')}
              onToggle={() => toggleSection('business-info')}
            >
              <div className="space-y-6">
                <p className="text-gray-400">
                  Stripe uses standard &quot;business&quot; fields for compliance.
                </p>

                {/* Business Category */}
                <div>
                  <h4 className="text-white font-medium mb-2">Business category</h4>
                  <div className="bg-[#252525] rounded-lg p-4">
                    <p className="text-white">Other entertainment and recreation</p>
                  </div>
                </div>

                {/* Business Description */}
                <div>
                  <h4 className="text-white font-medium mb-2">Business description</h4>
                  <p className="text-gray-400 text-sm mb-3">
                    If it accurately reflects your activity, you may use the following wording as an example:
                  </p>
                  <div className="bg-[#252525] rounded-lg p-4">
                    <p className="text-gray-300 text-sm italic">
                      &quot;Independent DJ providing live audio performances and radio-style broadcasts to online audiences. Earnings come from voluntary listener tips.&quot;
                    </p>
                  </div>
                  <p className="text-gray-500 text-sm mt-2">
                    You may adapt this description as needed.
                  </p>
                </div>
              </div>
            </AccordionSection>

            {/* Business Website */}
            <AccordionSection
              id="business-website"
              title="Business website"
              isOpen={openSections.has('business-website')}
              onToggle={() => toggleSection('business-website')}
            >
              <div className="space-y-4">
                <p className="text-gray-400">
                  Stripe requires a public online presence related to your DJ activity.
                </p>
                <p className="text-gray-400">
                  If you don&apos;t have a website, you may provide a public profile or page that represents your work.
                </p>
                <div className="p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-lg">
                  <p className="text-yellow-200 text-sm">
                    The link must be publicly accessible and clearly related to your DJ or music activity.
                  </p>
                </div>
              </div>
            </AccordionSection>

            {/* Bank Account & Payouts */}
            <AccordionSection
              id="bank-payouts"
              title="Bank account & payouts"
              isOpen={openSections.has('bank-payouts')}
              onToggle={() => toggleSection('bank-payouts')}
            >
              <div className="space-y-3">
                <ul className="text-gray-400 space-y-2 list-disc list-inside">
                  <li>Add your personal bank account</li>
                  <li>Payouts are sent directly by Stripe</li>
                  <li>If setup isn&apos;t complete, support can still be sent, but payouts will remain pending</li>
                </ul>
              </div>
            </AccordionSection>

            {/* Taxes */}
            <AccordionSection
              id="taxes"
              title="Taxes (general information)"
              isOpen={openSections.has('taxes')}
              onToggle={() => toggleSection('taxes')}
            >
              <div className="space-y-4">
                <p className="text-gray-400">
                  Stripe may be required to collect tax information and report payouts depending on your country and total earnings.
                </p>
                <div className="p-4 bg-[#252525] border border-gray-700 rounded-lg">
                  <p className="text-gray-400 text-sm">
                    Channel does not provide tax or legal advice. You are responsible for complying with your local obligations.
                  </p>
                </div>
              </div>
            </AccordionSection>
          </div>
        </div>
      </main>
    </div>
  );
}

interface AccordionSectionProps {
  id: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionSection({ title, isOpen, onToggle, children }: AccordionSectionProps) {
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-5 text-left flex items-center justify-between hover:bg-[#252525]/50 transition-colors"
      >
        <span className="text-white font-medium text-lg pr-4">{title}</span>
        <svg
          className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform duration-300 ${
            isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-6 pb-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
