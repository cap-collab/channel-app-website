'use client';

import { useState } from 'react';
import { DJApplicationSerialized, DJApplicationStatus, TimeSlot } from '@/types/dj-application';

interface ApplicationModalProps {
  application: DJApplicationSerialized;
  onClose: () => void;
  onStatusChange: (
    applicationId: string,
    newStatus: DJApplicationStatus,
    additionalData?: { selectedSlot?: { start: number; end: number } }
  ) => Promise<{ broadcastUrl?: string } | void>;
}

function getApplicationType(app: DJApplicationSerialized): 'profile' | 'livestream' {
  if (app.city || app.genre) return 'profile';
  return 'livestream';
}

export function ApplicationModal({ application, onClose, onStatusChange }: ApplicationModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preferredSlots = application.preferredSlots || [];
  const selectedSlot = selectedSlotIndex !== null ? preferredSlots[selectedSlotIndex] : null;
  const appType = getApplicationType(application);

  // Generate mailto link - opens in new tab
  const openMailto = (subject: string, body: string) => {
    const mailto = `mailto:${application.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, '_blank');
  };

  // Format time in a specific timezone
  const formatTimeInTimezone = (timestamp: number, timezone: string, options?: Intl.DateTimeFormatOptions) => {
    return new Date(timestamp).toLocaleString('en-US', { timeZone: timezone, ...options });
  };

  // Get short timezone name (e.g., "EST", "PST")
  const getTimezoneAbbr = (timezone: string, timestamp: number) => {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' });
    const parts = formatter.formatToParts(new Date(timestamp));
    return parts.find(p => p.type === 'timeZoneName')?.value || timezone;
  };

  // Handle approve
  const handleApprove = async () => {
    if (!selectedSlot) {
      setError('Please select a time slot');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const result = await onStatusChange(application.id, 'approved', { selectedSlot });

      // Format time in DJ's timezone for the email
      const djTimezone = application.timezone || 'America/New_York';
      const djTz = getTimezoneAbbr(djTimezone, selectedSlot.start);
      const formattedDate = formatTimeInTimezone(selectedSlot.start, djTimezone, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const formattedStart = formatTimeInTimezone(selectedSlot.start, djTimezone, { hour: 'numeric', minute: '2-digit' });
      const formattedEnd = formatTimeInTimezone(selectedSlot.end, djTimezone, { hour: 'numeric', minute: '2-digit' });

      const broadcastUrl = result?.broadcastUrl || '[Broadcast URL will be provided]';

      // Open mailto with approval email
      openMailto(
        `You're scheduled to livestream on Channel — ${formattedDate}`,
        `Hi ${application.djName},

You're officially scheduled to livestream on Channel!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Show: ${application.showName || application.djName}
Date: ${formattedDate}
Time: ${formattedStart} – ${formattedEnd} ${djTz}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. COMPLETE YOUR DJ PROFILE

Your DJ profile is what listeners see on our calendar, in your show details, and while you're live. A complete profile helps people connect with you and support your work.

Please take a few minutes to set up your DJ profile. IMPORTANT: Sign up using THIS email address (${application.email}) so we can link your profile to your scheduled show.
→ https://channel-app.com/studio

• Connect Stripe so you can receive listener support during your set. If Stripe isn't connected, listeners can still send support — but payouts will be delayed until you finish setup.
  See our setup guide: https://channel-app.com/stripe-setup

• Add a profile photo (this shows up during your set)
• Write a short bio (who you are / what you play)
• Add a promo text
• Add anything you want to show on your personal DJ page

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2. PREPARE YOUR LIVE STREAM

You'll broadcast using your private link below. Do not share this link.

Your broadcast link:
${broadcastUrl}

We strongly recommend:
• Opening the link ahead of time
• Doing a quick test stream (sound levels, connection, device)
• Using the same setup you'll use for the live set

→ Full streaming setup guide: https://channel-app.com/streaming-guide

Need help? Contact support@channel-app.com

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. DAY OF THE SHOW

• Join a few minutes early
• Once you hit "Go Live," listeners will be able to tune in, chat, and support you in real time
• You'll see live feedback and support messages during the set
• Share your live stream URL: https://channel-app.com/channel

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

That's it — we're excited to have you on Channel.

See you on air,
– The Channel Team`
      );

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve application');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle request more info
  const handleRequestInfo = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      await onStatusChange(application.id, 'info-requested');

      // Open mailto
      openMailto(
        'Channel - Your DJ Application',
        `Hey ${application.djName},

Thanks for applying to broadcast on Channel!

Before we can schedule your set, we'd love to learn a bit more:

[Add your questions here]

Looking forward to hearing from you.

- Channel`
      );

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update application');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle deny
  const handleDeny = async () => {
    setIsProcessing(true);
    setError(null);

    try {
      await onStatusChange(application.id, 'denied');

      // Open mailto
      openMailto(
        'Channel - Application Update',
        `Hey ${application.djName},

Thanks for your interest in broadcasting on Channel.

After reviewing your application, we're not able to schedule a set at this time. This isn't a reflection of your work - we're being very selective as we grow and focusing on a specific sound and vibe right now.

If things change or you'd like to apply again in the future, you're always welcome to reach out.

Thanks for understanding.

- Channel`
      );

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny application');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatSlotTime = (slot: TimeSlot) => {
    const djTimezone = application.timezone || 'America/New_York';
    const adminTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Show in DJ's timezone
    const djStart = formatTimeInTimezone(slot.start, djTimezone, { hour: 'numeric', minute: '2-digit' });
    const djEnd = formatTimeInTimezone(slot.end, djTimezone, { hour: 'numeric', minute: '2-digit' });
    const djDate = formatTimeInTimezone(slot.start, djTimezone, { weekday: 'short', month: 'short', day: 'numeric' });
    const djTz = getTimezoneAbbr(djTimezone, slot.start);

    // Show in admin's timezone if different
    if (djTimezone !== adminTimezone) {
      const adminStart = formatTimeInTimezone(slot.start, adminTimezone, { hour: 'numeric', minute: '2-digit' });
      const adminEnd = formatTimeInTimezone(slot.end, adminTimezone, { hour: 'numeric', minute: '2-digit' });
      const adminDate = formatTimeInTimezone(slot.start, adminTimezone, { weekday: 'short', month: 'short', day: 'numeric' });
      const adminTz = getTimezoneAbbr(adminTimezone, slot.start);
      return `${djDate} ${djStart} - ${djEnd} ${djTz} (DJ) / ${adminDate} ${adminStart} - ${adminEnd} ${adminTz} (you)`;
    }

    return `${djDate} ${djStart} - ${djEnd} ${djTz}`;
  };

  const isActionable = application.status === 'pending' || application.status === 'info-requested';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-[#1a1a1a] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#1a1a1a] border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">Application Details</h2>
            <span className={`px-2 py-0.5 text-xs rounded border ${
              appType === 'profile'
                ? 'bg-purple-900/30 text-purple-400 border-purple-800'
                : 'bg-cyan-900/30 text-cyan-400 border-cyan-800'
            }`}>
              {appType === 'profile' ? 'Profile Claim' : 'Livestream Request'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">DJ Name</label>
              <p className="text-white font-medium">{application.djName}</p>
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide">Email</label>
              <p className="text-white">{application.email}</p>
            </div>
          </div>

          {/* Profile Claim fields */}
          {appType === 'profile' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">City</label>
                <p className="text-white">{application.city || '—'}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide">Genre</label>
                <p className="text-white">{application.genre || '—'}</p>
              </div>
              {application.onlineRadioShow && (
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Online Radio Show</label>
                  <p className="text-white">{application.onlineRadioShow}</p>
                </div>
              )}
            </div>
          )}

          {/* Livestream-specific fields */}
          {appType === 'livestream' && (
            <div className="grid grid-cols-2 gap-4">
              {application.showName && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Show Name</label>
                  <p className="text-white">{application.showName}</p>
                </div>
              )}
              {application.setDuration && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Set Duration</label>
                  <p className="text-white">{application.setDuration} hours</p>
                </div>
              )}
              {application.locationType && (
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide">Location</label>
                  <p className="text-white capitalize">
                    {application.locationType}
                    {application.venueName && ` - ${application.venueName}`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Setup Support Flag (livestream only) */}
          {appType === 'livestream' && application.needsSetupSupport && (
            <div className="p-3 bg-yellow-900/30 border border-yellow-800 rounded-xl">
              <p className="text-yellow-400 text-sm font-medium flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Needs setup support
              </p>
            </div>
          )}

          {/* Comments */}
          {application.comments && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide block mb-2">Comments</label>
              <p className="text-gray-300 text-sm whitespace-pre-wrap bg-gray-800/50 p-4 rounded-lg">{application.comments}</p>
            </div>
          )}

          {/* Social Links */}
          {(application.soundcloud || application.instagram || application.youtube) && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide block mb-2">Social Links</label>
              <div className="flex flex-wrap gap-2">
                {application.soundcloud && (
                  <a
                    href={application.soundcloud.startsWith('http') ? application.soundcloud : `https://soundcloud.com/${application.soundcloud}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-orange-900/30 text-orange-400 border border-orange-800 rounded-lg text-sm hover:bg-orange-900/50"
                  >
                    SoundCloud
                  </a>
                )}
                {application.instagram && (
                  <a
                    href={application.instagram.startsWith('http') ? application.instagram : `https://instagram.com/${application.instagram.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-pink-900/30 text-pink-400 border border-pink-800 rounded-lg text-sm hover:bg-pink-900/50"
                  >
                    Instagram
                  </a>
                )}
                {application.youtube && (
                  <a
                    href={application.youtube.startsWith('http') ? application.youtube : `https://youtube.com/${application.youtube}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-red-900/30 text-red-400 border border-red-800 rounded-lg text-sm hover:bg-red-900/50"
                  >
                    YouTube
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Preferred Slots (livestream only) */}
          {preferredSlots.length > 0 && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide block mb-2">
                Preferred Time Slots
                {isActionable && <span className="text-gray-600 normal-case"> (select one to approve)</span>}
              </label>
              <div className="space-y-2">
                {preferredSlots.map((slot, index) => (
                  <button
                    key={index}
                    onClick={() => isActionable && setSelectedSlotIndex(index)}
                    disabled={!isActionable}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      selectedSlotIndex === index
                        ? 'bg-green-900/30 border-green-700 text-green-400'
                        : isActionable
                        ? 'bg-gray-800/50 border-gray-700 hover:border-gray-600 text-gray-300'
                        : 'bg-gray-800/30 border-gray-800 text-gray-500'
                    }`}
                  >
                    {formatSlotTime(slot)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Submitted Date */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide">Submitted</label>
            <p className="text-gray-400">
              {new Date(application.submittedAt).toLocaleString()}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          {isActionable && (
            <div className="pt-4 border-t border-gray-800">
              {appType === 'livestream' ? (
                <>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleApprove}
                      disabled={isProcessing || selectedSlotIndex === null}
                      className="flex-1 min-w-[140px] py-3 px-4 bg-green-600 text-white rounded-xl font-medium hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? 'Processing...' : 'Approve & Schedule'}
                    </button>
                    <button
                      onClick={handleRequestInfo}
                      disabled={isProcessing}
                      className="flex-1 min-w-[140px] py-3 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors disabled:opacity-50"
                    >
                      Request Info
                    </button>
                    <button
                      onClick={handleDeny}
                      disabled={isProcessing}
                      className="flex-1 min-w-[140px] py-3 px-4 bg-gray-700 text-white rounded-xl font-medium hover:bg-gray-600 transition-colors disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-3 text-center">
                    Each action will open your email app with a pre-filled message to edit and send.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={handleRequestInfo}
                      disabled={isProcessing}
                      className="flex-1 min-w-[140px] py-3 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors disabled:opacity-50"
                    >
                      Request Info
                    </button>
                    <button
                      onClick={handleDeny}
                      disabled={isProcessing}
                      className="flex-1 min-w-[140px] py-3 px-4 bg-gray-700 text-white rounded-xl font-medium hover:bg-gray-600 transition-colors disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-3 text-center">
                    Each action will open your email app with a pre-filled message to edit and send.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Already processed */}
          {!isActionable && (
            <div className="pt-4 border-t border-gray-800">
              <div className={`p-4 rounded-xl text-center ${
                application.status === 'approved'
                  ? 'bg-green-900/20 text-green-400'
                  : 'bg-red-900/20 text-red-400'
              }`}>
                This application has been {application.status}.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
