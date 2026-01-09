import { Metadata } from 'next';
import { StripeSetupClient } from './StripeSetupClient';

export const metadata: Metadata = {
  title: 'Set up Stripe - Channel',
  description: 'Set up Stripe to receive support on Channel. Step-by-step guide to complete your Stripe onboarding.',
};

export default function StripeSetupPage() {
  return <StripeSetupClient />;
}
