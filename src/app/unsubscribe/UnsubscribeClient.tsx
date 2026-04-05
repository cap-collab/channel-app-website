"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Header } from "@/components/Header";

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");

  const messages: Record<string, { title: string; description: string }> = {
    success: {
      title: "You've been unsubscribed",
      description:
        "You won't receive marketing emails from us anymore. If you change your mind, you can sign up again on channel-app.com.",
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
