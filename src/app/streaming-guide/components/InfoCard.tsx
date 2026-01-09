'use client';

interface InfoCardProps {
  type: 'success' | 'info' | 'warning';
  title: string;
  message: string;
  isVisible: boolean;
  actionLabel?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}

export function InfoCard({
  type,
  title,
  message,
  isVisible,
  actionLabel,
  onAction,
  children,
}: InfoCardProps) {
  if (!isVisible) return null;

  const colors = {
    success: {
      bg: 'bg-green-900/30',
      border: 'border-green-800',
      icon: 'text-green-500',
    },
    info: {
      bg: 'bg-blue-900/30',
      border: 'border-blue-800',
      icon: 'text-blue-500',
    },
    warning: {
      bg: 'bg-yellow-900/30',
      border: 'border-yellow-800',
      icon: 'text-yellow-500',
    },
  };

  const { bg, border, icon } = colors[type];

  const icons = {
    success: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    info: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  };

  return (
    <div className={`${bg} border ${border} rounded-xl p-6 animate-fadeIn`}>
      <div className="flex items-start gap-4">
        <div className={`${icon} flex-shrink-0 mt-0.5`}>
          {icons[type]}
        </div>
        <div className="flex-1">
          <h3 className="text-white font-semibold">{title}</h3>
          <p className="text-gray-400 mt-1">{message}</p>

          {children}

          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="mt-6 bg-white text-black py-3 px-6 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
