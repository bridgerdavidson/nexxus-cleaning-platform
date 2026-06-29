"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useImageUpload } from "@/hooks/useImageUpload";
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_MAX_FILE_SIZE,
  IMAGE_ACCEPT_ATTR,
  validateImageFile,
} from "@/lib/upload";

/** Shared redesign avatar control (brand tokens, no legacy yellow). Reuses only
 *  the headless useImageUpload pipeline (HEIC convert + compress + retry, writes
 *  user_profiles.avatar_url). Calls onUploaded(url) so the container can sync the
 *  in-memory auth profile. Used by the cleaner profile and operator settings.
 *  `initials` must be non-empty (AvatarFallback renders it directly). */
export function AvatarEditor({
  currentAvatarUrl,
  initials,
  onUploaded,
}: {
  currentAvatarUrl?: string;
  initials: string;
  onUploaded: (url: string) => void;
}) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { items, start, reset, isWorking } = useImageUpload({
    context: { kind: "avatar", ctx: { userId: user?.id ?? "", currentAvatarUrl } },
    onComplete: ({ uploaded, failed }) => {
      if (uploaded[0]) {
        if (preview) URL.revokeObjectURL(preview);
        setPreview(null);
        setPendingFile(null);
        onUploaded(uploaded[0].url);
        reset();
      } else if (failed[0]) {
        setError(failed[0].message);
      }
    },
  });

  const status = items[0]?.status;
  const statusLabel =
    status === "converting"
      ? "Converting"
      : status === "compressing"
        ? "Compressing"
        : status === "uploading"
          ? "Uploading"
          : "Saving";

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const v = validateImageFile(file, AVATAR_ALLOWED_TYPES, AVATAR_MAX_FILE_SIZE);
    if (!v.valid) {
      setError(v.error ?? "That file won't work. Try a JPG or PNG.");
      return;
    }
    setError(null);
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  }, []);

  const onCancel = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setPendingFile(null);
    setError(null);
    reset();
  }, [preview, reset]);

  const onSave = useCallback(() => {
    if (!pendingFile) return;
    if (!user?.id) {
      setError("You must be signed in to change your photo.");
      return;
    }
    setError(null);
    start([pendingFile]);
  }, [pendingFile, user?.id, start]);

  const displayUrl = preview ?? currentAvatarUrl;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <Avatar className="size-16 shadow-soft-sm ring-2 ring-card">
          {displayUrl ? <AvatarImage src={displayUrl} alt="Your profile photo" className="object-cover" /> : null}
          <AvatarFallback className="bg-brand-600 text-lg font-bold text-white">{initials}</AvatarFallback>
        </Avatar>
        {!pendingFile && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isWorking}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 grid size-7 place-items-center rounded-pill bg-brand-600 text-white shadow-soft-sm outline-none ring-2 ring-card transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <Camera className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {pendingFile ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" loading={isWorking} onClick={onSave}>
              {isWorking ? statusLabel : "Save photo"}
            </Button>
            {!isWorking && (
              <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-control text-sm font-semibold text-brand-600 outline-none transition-colors hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {currentAvatarUrl ? "Change photo" : "Add photo"}
          </button>
        )}
        {error && (
          <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-destructive">
            <X className="size-3.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        onChange={onPick}
        className="hidden"
        aria-hidden
      />
    </div>
  );
}
