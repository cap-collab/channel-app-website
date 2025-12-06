import { ReactNode } from "react";

interface PhoneMockupProps {
  children: ReactNode;
  className?: string;
}

export default function PhoneMockup({ children, className = "" }: PhoneMockupProps) {
  return (
    <div className={`relative ${className}`}>
      {/* iPhone frame */}
      <div className="relative bg-gray-900 rounded-[3rem] p-3 shadow-2xl border border-gray-800">
        {/* Notch / Dynamic Island */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-black rounded-b-2xl z-10" />

        {/* Screen */}
        <div className="relative bg-black rounded-[2.25rem] overflow-hidden aspect-[9/19.5]">
          {/* Status bar */}
          <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-8 z-20">
            <span className="text-white text-sm font-semibold">9:41</span>
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3C7.5 3 3.5 5.5 1 9.5L12 21l11-11.5C20.5 5.5 16.5 3 12 3z" />
              </svg>
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2 17h2v4H2v-4zm4-5h2v9H6v-9zm4-4h2v13h-2V8zm4-4h2v17h-2V4zm4 7h2v10h-2V11z" />
              </svg>
              <div className="w-6 h-3 bg-white rounded-sm ml-1" />
            </div>
          </div>

          {/* Content */}
          <div className="pt-12 h-full overflow-hidden">
            {children}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/30 rounded-full" />
        </div>
      </div>
    </div>
  );
}
