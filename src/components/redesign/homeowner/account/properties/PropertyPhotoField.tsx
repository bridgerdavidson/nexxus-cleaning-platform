'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Home, Loader2 } from 'lucide-react';
import { useImageUpload } from '@/hooks/useImageUpload';
import {
  validateImageFile,
  PROPERTY_PHOTOS_ALLOWED_TYPES,
  PROPERTY_PHOTOS_MAX_FILE_SIZE,
  IMAGE_ACCEPT_ATTR,
} from '@/lib/upload';
import { toast } from '@/components/ui/toast';

/** On-system property photo control: uploads to storage via the shared image
 *  pipeline and returns the URL to the parent (which persists it on save). */
export function PropertyPhotoField({
  propertyId,
  currentPhotoUrl,
  onUploaded,
}: {
  propertyId: string;
  currentPhotoUrl?: string | null;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const { start, reset, isWorking } = useImageUpload({
    context: { kind: 'property', ctx: { propertyId, currentPhotoUrl } },
    onComplete: ({ uploaded, failed }) => {
      if (uploaded[0]) {
        onUploaded(uploaded[0].url);
        reset();
      } else if (failed[0]) {
        if (preview) URL.revokeObjectURL(preview);
        setPreview(null);
        toast.error('Photo upload failed', { description: failed[0].message });
      }
    },
  });

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const onPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      const v = validateImageFile(file, PROPERTY_PHOTOS_ALLOWED_TYPES, PROPERTY_PHOTOS_MAX_FILE_SIZE);
      if (!v.valid) {
        toast.error(v.error ?? 'That file is not a supported image.');
        return;
      }
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(file));
      start([file]);
    },
    [preview, start],
  );

  const displayUrl = preview ?? currentPhotoUrl ?? null;

  return (
    <div className="flex items-center gap-3">
      <span className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-control bg-brand-50 text-brand-600">
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displayUrl} alt="" className="size-full object-cover" />
        ) : (
          <Home className="size-6" aria-hidden />
        )}
        {isWorking && (
          <span className="absolute inset-0 grid place-items-center bg-black/40">
            <Loader2 className="size-5 animate-spin text-white" aria-label="Uploading" />
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isWorking}
        className="inline-flex items-center gap-1.5 rounded-control border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <Camera className="size-4" aria-hidden /> {displayUrl ? 'Change photo' : 'Add photo'}
      </button>
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
