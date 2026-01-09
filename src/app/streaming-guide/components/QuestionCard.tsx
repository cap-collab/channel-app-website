'use client';

interface QuestionCardProps {
  question: string;
  description?: string;
  onYes: () => void;
  onNo: () => void;
  isVisible: boolean;
}

export function QuestionCard({
  question,
  description,
  onYes,
  onNo,
  isVisible,
}: QuestionCardProps) {
  if (!isVisible) return null;

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-6 animate-fadeIn">
      <h2 className="text-xl font-semibold text-white mb-2">{question}</h2>
      {description && (
        <p className="text-gray-400 text-sm mb-6">{description}</p>
      )}
      <div className="flex gap-4">
        <button
          onClick={onYes}
          className="flex-1 py-3 px-4 rounded-xl border border-gray-700 bg-[#1a1a1a] text-white hover:bg-white hover:text-black hover:border-white transition-all"
        >
          Yes
        </button>
        <button
          onClick={onNo}
          className="flex-1 py-3 px-4 rounded-xl border border-gray-700 bg-[#1a1a1a] text-white hover:bg-white hover:text-black hover:border-white transition-all"
        >
          No
        </button>
      </div>
    </div>
  );
}
