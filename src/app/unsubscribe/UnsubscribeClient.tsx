"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { Header } from "@/components/Header";

function UnsubscribeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const [dismissed, setDismissed] = useState(false);

  const successDescription =
    category === "dj"
      ? "You won't receive newsletter updates from Channel anymore. Your per-show and watchlist alerts are unchanged."
      : "You won't receive newsletter updates from Channel anymore.";

  const messages: Record<string, { title: string; description: string }> = {
    success: {
      title: "You have been unsubscribed",
      description: successDescription,
    },
    not_found: {
      title: "Email not found",
      description:
        "We couldn't find that email address in our list. You may have already unsubscribed.",
    },
    invalid: {
      title: "Invalid link",
      description:
        "This unsubscribe link appears to be invalid. If you're having trouble, reach out to us.",
    },
    error: {
      title: "Something went wrong",
      description:
        "We couldn't process your request right now. Please try again later.",
    },
  };

  const message = messages[status || ""] || messages.invalid;

  return (
    <main className="max-w-xl mx-auto p-4">
      <div className="text-center py-16">
        <h1 className="text-white text-xl font-semibold mb-3">
          {message.title}
        </h1>
        <p className="text-gray-500 text-sm">{message.description}</p>
      </div>

      {status === "success" && !dismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#111] border border-white/10 rounded-lg max-w-sm w-full p-6 text-center">
            <h2 className="text-white text-lg font-semibold mb-2">
              You have been unsubscribed
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              {successDescription}
            </p>
            <button
              onClick={() => {
                setDismissed(true);
                router.push("/");
              }}
              className="bg-white text-black px-6 py-2 rounded font-medium hover:bg-gray-100 transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export function UnsubscribeClient() {
  return (
    <div className="min-h-screen bg-black">
      <Header position="sticky" />
      <Suspense
        fallback={
          <main className="max-w-xl mx-auto p-4">
            <div className="text-center py-16">
              <div className="w-6 h-6 border-2 border-gray-700 border-t-white rounded-full animate-spin mx-auto" />
            </div>
          </main>
        }
      >
        <UnsubscribeContent />
      </Suspense>
    </div>
  );
}
