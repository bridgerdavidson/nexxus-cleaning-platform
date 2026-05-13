"use client";

import React, { useMemo } from "react";
import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

import type { MessageAttachment } from "../types";

interface MessageAttachmentsLightboxProps {
  attachments: MessageAttachment[];
  open: boolean;
  index: number;
  onClose: () => void;
}

/**
 * Lightbox scoped to the attachments of a single message bubble. Each bubble
 * owns its own instance, so clicking an image in one message only browses
 * that message's attachments — not every photo ever sent in the thread.
 */
export default function MessageAttachmentsLightbox({
  attachments,
  open,
  index,
  onClose,
}: MessageAttachmentsLightboxProps) {
  const slides = useMemo(
    () =>
      attachments.map((a) => ({
        src: a.file_url,
        attachmentId: a.id,
      })),
    [attachments],
  );

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={index}
      slides={slides}
      plugins={[Zoom, Download, Thumbnails, Fullscreen]}
      // Thumbnails strip is useful when there are multiple images; hide it
      // for single-image messages so the chrome stays out of the way.
      thumbnails={{ showToggle: true, position: "bottom" }}
      carousel={{ finite: true }}
      controller={{ closeOnBackdropClick: true }}
      styles={{ container: { zIndex: 300 } }}
      download={{
        download: async ({ slide, saveAs }) => {
          const meta = slide as (typeof slides)[number];
          const filename = `attachment-${meta.attachmentId.slice(0, 8)}.jpg`;
          try {
            const res = await fetch(slide.src);
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const blob = await res.blob();
            saveAs(blob, filename);
          } catch (err) {
            console.error("Attachment download failed:", err);
            saveAs(slide.src, filename);
          }
        },
      }}
    />
  );
}
