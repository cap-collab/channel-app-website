"use client";

import { useState } from "react";
import Link from "next/link";

interface FAQItem {
  question: string;
  answer: string;
  hasLink?: boolean;
}

interface FAQAccordionProps {
  items: FAQItem[];
}

function renderAnswer(answer: string, hasLink?: boolean) {
  if (hasLink) {
    // Define link patterns to replace
    const linkPatterns = [
      { text: "TestFlight", href: "https://testflight.apple.com/join/HcKTJ1nH", external: true },
      { text: "Sign up and apply here", href: "/studio/join" },
      { text: "streaming guide", href: "/streaming-guide" },
      { text: "tune in", href: "/channel" },
    ];

    // Split and rebuild with links
    let result: (string | JSX.Element)[] = [answer];

    for (const pattern of linkPatterns) {
      const newResult: (string | JSX.Element)[] = [];
      for (const part of result) {
        if (typeof part === 'string' && part.includes(pattern.text)) {
          const segments = part.split(pattern.text);
          segments.forEach((segment, i) => {
            if (segment) newResult.push(segment);
            if (i < segments.length - 1) {
              if ('external' in pattern && pattern.external) {
                newResult.push(
                  <a
                    key={`${pattern.href}-${i}`}
                    href={pattern.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white underline hover:text-gray-300 transition-colors"
                  >
                    {pattern.text}
                  </a>
                );
              } else {
                newResult.push(
                  <Link
                    key={`${pattern.href}-${i}`}
                    href={pattern.href}
                    className="text-white underline hover:text-gray-300 transition-colors"
                  >
                    {pattern.text}
                  </Link>
                );
              }
            }
          });
        } else {
          newResult.push(part);
        }
      }
      result = newResult;
    }

    return <>{result}</>;
  }
  return answer;
}

export default function FAQAccordion({ items }: FAQAccordionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={index}
          className="border border-gray-800 rounded-xl overflow-hidden"
        >
          <button
            onClick={() => toggle(index)}
            className="w-full px-6 py-5 text-left flex items-center justify-between hover:bg-[#252525]/50 transition-colors"
          >
            <span className="text-white font-medium text-lg pr-4">
              {item.question}
            </span>
            <svg
              className={`w-5 h-5 text-gray-500 flex-shrink-0 transition-transform duration-300 ${
                openIndex === index ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <div
            className={`grid transition-all duration-300 ease-out ${
              openIndex === index ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <div className="px-6 pb-5 text-gray-400 leading-relaxed">
                {renderAnswer(item.answer, item.hasLink)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
