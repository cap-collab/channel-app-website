"use client";

import { useState } from "react";
import Link from "next/link";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  radioUrl: string;
  streamUrl: string;
  scheduleUrl: string;
  socialMedia: string;
  plays24_7: boolean | null;
  message: string;
}

type FormStatus = "idle" | "submitting" | "success" | "error";

export function ApplyClient() {
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    radioUrl: "",
    streamUrl: "",
    scheduleUrl: "",
    socialMedia: "",
    plays24_7: null,
    message: "",
  });
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = (): boolean => {
    if (!formData.firstName.trim()) {
      setErrorMessage("First name is required");
      return false;
    }
    if (!formData.lastName.trim()) {
      setErrorMessage("Last name is required");
      return false;
    }
    if (!formData.email.trim()) {
      setErrorMessage("Email is required");
      return false;
    }
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setErrorMessage("Please enter a valid email address");
      return false;
    }
    if (!formData.radioUrl.trim()) {
      setErrorMessage("Radio website URL is required");
      return false;
    }
    // Basic URL validation for radio URL
    try {
      new URL(formData.radioUrl);
    } catch {
      setErrorMessage("Please enter a valid radio website URL");
      return false;
    }
    // Validate optional URLs if provided
    if (formData.streamUrl.trim()) {
      try {
        new URL(formData.streamUrl);
      } catch {
        setErrorMessage("Please enter a valid stream URL");
        return false;
      }
    }
    if (formData.scheduleUrl.trim()) {
      try {
        new URL(formData.scheduleUrl);
      } catch {
        setErrorMessage("Please enter a valid schedule URL");
        return false;
      }
    }
    if (formData.plays24_7 === null) {
      setErrorMessage("Please indicate if you play content 24/7");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    if (!validateForm()) return;

    try {
      // Dynamically import Firebase to avoid SSR issues
      const { db } = await import("@/lib/firebase");
      const { collection, addDoc, serverTimestamp } = await import(
        "firebase/firestore"
      );

      if (!db) {
        throw new Error("Firebase not configured");
      }

      setStatus("submitting");

      // Create Firestore document
      await addDoc(collection(db, "station-applications"), {
        firstName: formData.firstName.trim(),
        lastName: formData.lastName.trim(),
        email: formData.email.trim(),
        radioUrl: formData.radioUrl.trim(),
        streamUrl: formData.streamUrl.trim() || null,
        scheduleUrl: formData.scheduleUrl.trim() || null,
        socialMedia: formData.socialMedia.trim() || null,
        plays24_7: formData.plays24_7,
        message: formData.message.trim() || null,
        submittedAt: serverTimestamp(),
        status: "pending",
      });

      // Send email notification
      try {
        await fetch("/api/send-application-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: formData.firstName.trim(),
            lastName: formData.lastName.trim(),
            email: formData.email.trim(),
            radioUrl: formData.radioUrl.trim(),
            streamUrl: formData.streamUrl.trim() || null,
            scheduleUrl: formData.scheduleUrl.trim() || null,
            socialMedia: formData.socialMedia.trim() || null,
            plays24_7: formData.plays24_7,
            message: formData.message.trim() || null,
          }),
        });
      } catch (emailError) {
        // Don't fail the submission if email fails
        console.error("Email notification failed:", emailError);
      }

      setStatus("success");
    } catch (error) {
      console.error("Error submitting application:", error);
      setStatus("error");
      setErrorMessage(
        "Failed to submit application. Please try again or email us directly."
      );
    }
  };

  if (status === "success") {
    return (
      <div className="min-h-screen p-4 md:p-8">
        <div className="max-w-2xl mx-auto text-center py-20">
          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold mb-4">Application Submitted!</h1>
          <p className="text-gray-400 mb-8">
            Thank you for your interest in Channel, {formData.firstName}. We&apos;ll review your
            application and get back to you soon.
          </p>
          <Link
            href="/"
            className="inline-block bg-white text-black px-8 py-3 rounded-xl font-semibold hover:bg-gray-200 transition-colors"
          >
            Back to Channel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <header className="max-w-2xl mx-auto mb-8">
        <Link
          href="/"
          className="text-gray-500 hover:text-white text-sm transition-colors"
        >
          &larr; Back to Channel
        </Link>
      </header>

      <main className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Feature Your Station</h1>
        <p className="text-gray-400 mb-8">
          Want your radio station featured on Channel? Fill out the form below
          and we&apos;ll get back to you.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contact Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="firstName"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                First Name *
              </label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                placeholder="John"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>
            <div>
              <label
                htmlFor="lastName"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Last Name *
              </label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                placeholder="Doe"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Email *
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="john@example.com"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Radio URL */}
          <div>
            <label
              htmlFor="radioUrl"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Radio Website URL *
            </label>
            <input
              type="url"
              id="radioUrl"
              name="radioUrl"
              value={formData.radioUrl}
              onChange={handleInputChange}
              placeholder="https://yourradio.com"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Stream URL */}
          <div>
            <label
              htmlFor="streamUrl"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Stream URL (optional)
            </label>
            <input
              type="url"
              id="streamUrl"
              name="streamUrl"
              value={formData.streamUrl}
              onChange={handleInputChange}
              placeholder="https://stream.yourradio.com/live"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Schedule URL */}
          <div>
            <label
              htmlFor="scheduleUrl"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Schedule URL (optional)
            </label>
            <input
              type="url"
              id="scheduleUrl"
              name="scheduleUrl"
              value={formData.scheduleUrl}
              onChange={handleInputChange}
              placeholder="https://yourradio.com/schedule"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Social Media */}
          <div>
            <label
              htmlFor="socialMedia"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Social Media (optional)
            </label>
            <input
              type="text"
              id="socialMedia"
              name="socialMedia"
              value={formData.socialMedia}
              onChange={handleInputChange}
              placeholder="@yourradio or https://instagram.com/yourradio"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* 24/7 Content */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Do you play content 24/7? *
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, plays24_7: true }))}
                className={`flex-1 py-3 px-4 rounded-xl border transition-colors ${
                  formData.plays24_7 === true
                    ? "bg-white text-black border-white"
                    : "bg-gray-900 text-gray-300 border-gray-700 hover:border-gray-500"
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, plays24_7: false }))}
                className={`flex-1 py-3 px-4 rounded-xl border transition-colors ${
                  formData.plays24_7 === false
                    ? "bg-white text-black border-white"
                    : "bg-gray-900 text-gray-300 border-gray-700 hover:border-gray-500"
                }`}
              >
                No
              </button>
            </div>
          </div>

          {/* Message */}
          <div>
            <label
              htmlFor="message"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Message (optional)
            </label>
            <textarea
              id="message"
              name="message"
              value={formData.message}
              onChange={handleInputChange}
              rows={4}
              placeholder="Tell us about your station..."
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors resize-none"
            />
          </div>

          {/* Error message */}
          {errorMessage && (
            <div className="p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-400 text-sm">
              {errorMessage}
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full bg-white text-black py-4 rounded-xl font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === "submitting" ? (
              <>
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Application"
            )}
          </button>

          <p className="text-center text-gray-500 text-sm">
            Questions? Email us at{" "}
            <a
              href="mailto:info@channel-app.com"
              className="text-white hover:underline"
            >
              info@channel-app.com
            </a>
          </p>
        </form>
      </main>
    </div>
  );
}
