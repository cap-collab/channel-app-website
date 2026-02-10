'use client';

interface GenreAlertPromptProps {
  isOpen: boolean;
  onClose: () => void;
  onSignUp: () => void;
}

export function GenreAlertPrompt({ isOpen, onClose, onSignUp }: GenreAlertPromptProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white/[0.08] backdrop-blur-xl rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-white/[0.1]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
        </div>

        <h2 className="text-lg font-bold text-white mb-2 text-center">
          Receive alerts for shows matching your preferences?
        </h2>
        <p className="text-white/50 text-sm text-center mb-6">
          Sign up to get notified when shows in your favorite genres are scheduled
        </p>

        <button
          onClick={onSignUp}
          className="w-full py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-all"
        >
          Yes, sign me up
        </button>

        <button
          onClick={onClose}
          className="w-full mt-3 py-2 text-white/40 text-sm hover:text-white transition-colors"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
