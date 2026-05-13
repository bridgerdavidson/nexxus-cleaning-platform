"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { User, Camera, Loader2, AlertCircle, X } from "lucide-react";
import {
  AVATAR_MAX_FILE_SIZE,
  AVATAR_ALLOWED_TYPES,
  IMAGE_ACCEPT_ATTR,
  validateImageFile,
} from "../lib/upload";
import { useImageUpload } from "../hooks/useImageUpload";
import { useAuth } from "../hooks/useAuth";

interface AvatarUploadProps {
  currentAvatarUrl?: string;
  onUploadSuccess: (url: string) => void;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: { wrapper: "w-16 h-16", icon: "w-8 h-8", badge: "w-5 h-5 text-[10px]" },
  md: { wrapper: "w-24 h-24", icon: "w-12 h-12", badge: "w-7 h-7 text-xs" },
  lg: {
    wrapper: "w-24 h-24 sm:w-28 sm:h-28",
    icon: "w-12 h-12 sm:w-14 sm:h-14",
    badge: "w-8 h-8 text-sm",
  },
};

export default function AvatarUpload({
  currentAvatarUrl,
  onUploadSuccess,
  size = "lg",
}: AvatarUploadProps) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const classes = sizeClasses[size];

  const { items, start, reset, isWorking } = useImageUpload({
    context: { kind: "avatar", ctx: { userId: user?.id ?? "", currentAvatarUrl } },
    onComplete: ({ uploaded, failed }) => {
      if (uploaded[0]) {
        if (preview) URL.revokeObjectURL(preview);
        setPreview(null);
        setPendingFile(null);
        onUploadSuccess(uploaded[0].url);
        reset();
      } else if (failed[0]) {
        setError(failed[0].message);
      }
    },
  });

  // Surface status from the in-flight item (for the button label)
  const inFlight = items[0];
  const converting = inFlight?.status === "converting";
  const compressing = inFlight?.status === "compressing";
  const uploading = inFlight?.status === "uploading";

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      const validation = validateImageFile(file, AVATAR_ALLOWED_TYPES, AVATAR_MAX_FILE_SIZE);
      if (!validation.valid) {
        setError(validation.error ?? "Invalid file.");
        return;
      }

      setError(null);
      setPendingFile(file);
      setPreview(URL.createObjectURL(file));
    },
    [],
  );

  const handleUpload = useCallback(() => {
    if (!pendingFile) return;
    if (!user?.id) {
      setError("You must be logged in to upload an avatar.");
      return;
    }
    setError(null);
    start([pendingFile]);
  }, [pendingFile, user?.id, start]);

  const handleCancel = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setError(null);
    reset();
  }, [preview, reset]);

  const displayUrl = preview ?? currentAvatarUrl;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative group">
        <div
          className={`${classes.wrapper} rounded-full overflow-hidden bg-primary-100 flex items-center justify-center ring-4 ring-white shadow-md`}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt="Profile avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <User className={`${classes.icon} text-primary-600`} />
          )}
        </div>

        {!pendingFile && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isWorking}
            className={`absolute bottom-0 right-0 ${classes.badge} rounded-full bg-primary-600 text-white flex items-center justify-center shadow hover:bg-primary-700 transition-colors disabled:opacity-50`}
            aria-label="Change profile picture"
          >
            <Camera className="w-3 h-3" />
          </button>
        )}

        {pendingFile && !isWorking && (
          <button
            type="button"
            onClick={handleCancel}
            className={`absolute bottom-0 right-0 ${classes.badge} rounded-full bg-gray-500 text-white flex items-center justify-center shadow hover:bg-gray-600 transition-colors`}
            aria-label="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        onChange={handleFileChange}
        className="hidden"
        aria-hidden
      />

      {pendingFile && (
        <div className="flex items-center gap-4 mt-6">
          <button
            type="button"
            onClick={handleUpload}
            disabled={isWorking}
            className={`flex items-center justify-center gap-2 px-8 py-3.5 bg-primary-600 text-white text-[14.5px] font-semibold rounded-[1.25rem] hover:bg-primary-700 disabled:opacity-60 transition-all duration-300 shadow-[0_4px_12px_-2px_rgba(217,167,24,0.3)] hover:shadow-[0_8px_20px_-4px_rgba(217,167,24,0.4)] hover:-translate-y-0.5 active:translate-y-0`}
          >
            {converting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Converting…
              </>
            ) : compressing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Compressing…
              </>
            ) : uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading…
              </>
            ) : (
              "Save Photo"
            )}
          </button>
          {!isWorking && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-6 py-3.5 text-[14.5px] font-semibold text-gray-600 rounded-[1.25rem] hover:bg-gray-100/80 hover:text-gray-900 transition-all duration-300"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {!pendingFile && !isWorking && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[14.5px] text-primary-600 hover:text-primary-700 font-semibold transition-colors mt-4"
        >
          {currentAvatarUrl ? "Change photo" : "Upload photo"}
        </button>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-red-600 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
