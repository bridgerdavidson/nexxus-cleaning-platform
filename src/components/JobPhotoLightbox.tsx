"use client";

import React, { useMemo } from "react";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Download from "yet-another-react-lightbox/plugins/download";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import { format } from "date-fns";

import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

import type { JobPhoto } from "../hooks/useCleanerData";

interface JobPhotoLightboxProps {
  photos: JobPhoto[];
  open: boolean;
  index: number;
  onClose: () => void;
  appointmentId: string;
}

const SECTION_LABEL: Record<JobPhoto["photo_type"], string> = {
  before: "Before",
  during: "During",
  after: "After",
};

export default function JobPhotoLightbox({
  photos,
  open,
  index,
  onClose,
  appointmentId,
}: JobPhotoLightboxProps) {
  const slides = useMemo(
    () =>
      photos.map((photo) => {
        let uploadedLabel = "";
        try {
          uploadedLabel = format(
            new Date(photo.uploaded_at),
            "MMM d, yyyy · h:mm a",
          );
        } catch {
          uploadedLabel = "";
        }
        return {
          src: photo.photo_url,
          // Combined title keeps both the section label and timestamp at top-left,
          // away from the thumbnails strip at the bottom.
          title: (
            <span>
              <strong>{SECTION_LABEL[photo.photo_type]}</strong>
              {uploadedLabel ? (
                <span style={{ opacity: 0.75, marginLeft: 8 }}>
                  · {uploadedLabel}
                </span>
              ) : null}
            </span>
          ),
          // Carry metadata through so the download handler can name the file.
          photoId: photo.id,
          photoType: photo.photo_type,
        };
      }),
    [photos],
  );

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom, Download, Captions, Thumbnails, Fullscreen]}
      carousel={{ finite: false }}
      controller={{ closeOnBackdropClick: true }}
      styles={{ container: { zIndex: 300 } }}
      download={{
        download: async ({ slide, saveAs }) => {
          const meta = slide as (typeof slides)[number];
          const filename = `appt-${appointmentId}-${meta.photoType}-${meta.photoId.slice(0, 8)}.jpg`;
          try {
            const res = await fetch(slide.src);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const blob = await res.blob();
            saveAs(blob, filename);
          } catch (err) {
            console.error("Photo download failed:", err);
            // Fallback: hand the URL to saveAs and let the browser try.
            saveAs(slide.src, filename);
          }
        },
      }}
    />
  );
}
