"use client";

import { useState, useRef } from "react";
import Link from "next/link";

interface FormData {
  stationName: string;
  streamUrl: string;
  scheduleUrl: string;
  contactEmail: string;
  message: string;
  accentColor: string;
}

type FormStatus = "idle" | "uploading" | "submitting" | "success" | "error";

export function ApplyClient() {
  const [formData, setFormData] = useState<FormData>({
    stationName: "",
    streamUrl: "",
    scheduleUrl: "",
    contactEmail: "",
    message: "",
    accentColor: "#FF6B35",
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        setErrorMessage("Please upload an image file");
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setErrorMessage("Image must be smaller than 5MB");
        return;
      }

      setLogoFile(file);
      setErrorMessage("");

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const validateForm = (): boolean => {
    if (!formData.stationName.trim()) {
      setErrorMessage("Station name is required");
      return false;
    }
    if (!formData.streamUrl.trim()) {
      setErrorMessage("Stream URL is required");
      return false;
    }
    if (!formData.scheduleUrl.trim()) {
      setErrorMessage("Schedule URL is required");
      return false;
    }
    if (!formData.contactEmail.trim()) {
      setErrorMessage("Contact email is required");
      return false;
    }
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contactEmail)) {
      setErrorMessage("Please enter a valid email address");
      return false;
    }
    // Basic URL validation
    try {
      new URL(formData.streamUrl);
    } catch {
      setErrorMessage("Please enter a valid stream URL");
      return false;
    }
    try {
      new URL(formData.scheduleUrl);
    } catch {
      setErrorMessage("Please enter a valid schedule URL");
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
      const { storage, db } = await import("@/lib/firebase");
      const { ref, uploadBytes, getDownloadURL } = await import(
        "firebase/storage"
      );
      const { collection, addDoc, serverTimestamp } = await import(
        "firebase/firestore"
      );

      if (!storage || !db) {
        throw new Error("Firebase not configured");
      }

      setStatus("uploading");

      // Upload logo to Firebase Storage (if provided)
      let logoUrl = null;
      if (logoFile) {
        const logoRef = ref(
          storage,
          `station-applications/${Date.now()}-${logoFile.name}`
        );
        await uploadBytes(logoRef, logoFile);
        logoUrl = await getDownloadURL(logoRef);
      }

      setStatus("submitting");

      // Create Firestore document
      await addDoc(collection(db, "station-applications"), {
        stationName: formData.stationName.trim(),
        logoUrl,
        accentColor: formData.accentColor,
        streamUrl: formData.streamUrl.trim(),
        scheduleUrl: formData.scheduleUrl.trim(),
        contactEmail: formData.contactEmail.trim(),
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
            stationName: formData.stationName.trim(),
            streamUrl: formData.streamUrl.trim(),
            scheduleUrl: formData.scheduleUrl.trim(),
            contactEmail: formData.contactEmail.trim(),
            message: formData.message.trim() || null,
            accentColor: formData.accentColor,
            logoUrl,
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
            Thank you for your interest in Channel. We&apos;ll review your
            application and get back to you at{" "}
            <span className="text-white">{formData.contactEmail}</span> soon.
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
          {/* Station Name */}
          <div>
            <label
              htmlFor="stationName"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Station Name *
            </label>
            <input
              type="text"
              id="stationName"
              name="stationName"
              value={formData.stationName}
              onChange={handleInputChange}
              placeholder="e.g., NTS Radio"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Station Logo (optional)
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Upload your Instagram profile image or similar logo (max 5MB)
            </p>
            <div className="flex items-center gap-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-24 h-24 bg-gray-900 border-2 border-dashed border-gray-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-gray-500 transition-colors overflow-hidden"
              >
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <svg
                    className="w-8 h-8 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                className="hidden"
              />
              {logoFile && (
                <span className="text-sm text-gray-400">{logoFile.name}</span>
              )}
            </div>
          </div>

          {/* Accent Color */}
          <div>
            <label
              htmlFor="accentColor"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Accent Color
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Choose a brand color for your station
            </p>
            <div className="flex items-center gap-4">
              <input
                type="color"
                id="accentColor"
                name="accentColor"
                value={formData.accentColor}
                onChange={handleInputChange}
                className="w-12 h-12 rounded-lg cursor-pointer border-0 bg-transparent"
              />
              <input
                type="text"
                value={formData.accentColor.toUpperCase()}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    accentColor: e.target.value,
                  }))
                }
                className="px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white font-mono text-sm w-28 focus:outline-none focus:border-gray-500"
              />
              <div
                className="flex-1 h-12 rounded-xl"
                style={{ backgroundColor: formData.accentColor }}
              />
            </div>
          </div>

          {/* Stream URL */}
          <div>
            <label
              htmlFor="streamUrl"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Stream URL *
            </label>
            <input
              type="url"
              id="streamUrl"
              name="streamUrl"
              value={formData.streamUrl}
              onChange={handleInputChange}
              placeholder="https://stream.yourstation.com/live"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Schedule URL */}
          <div>
            <label
              htmlFor="scheduleUrl"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Schedule URL *
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Link to your online schedule or programming page
            </p>
            <input
              type="url"
              id="scheduleUrl"
              name="scheduleUrl"
              value={formData.scheduleUrl}
              onChange={handleInputChange}
              placeholder="https://yourstation.com/schedule"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Contact Email */}
          <div>
            <label
              htmlFor="contactEmail"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Contact Email *
            </label>
            <input
              type="email"
              id="contactEmail"
              name="contactEmail"
              value={formData.contactEmail}
              onChange={handleInputChange}
              placeholder="hello@yourstation.com"
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
            />
          </div>

          {/* Message */}
          <div>
            <label
              htmlFor="message"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Why feature on Channel? (optional)
            </label>
            <textarea
              id="message"
              name="message"
              value={formData.message}
              onChange={handleInputChange}
              rows={4}
              placeholder="Tell us about your station and community..."
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
            disabled={status === "uploading" || status === "submitting"}
            className="w-full bg-white text-black py-4 rounded-xl font-semibold hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status === "uploading" || status === "submitting" ? (
              <>
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                {status === "uploading"
                  ? "Uploading logo..."
                  : "Submitting..."}
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
