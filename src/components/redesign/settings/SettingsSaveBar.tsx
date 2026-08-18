"use client";

import { Button } from "@/components/ui/button";

export function SettingsSaveBar({
  visible, saving, onSave, onDiscard,
  message = "Unsaved changes",
  saveLabel = "Save changes",
  showDiscard = true,
}: {
  visible: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Status text on the left. Override for confirm-style bars ("accept the defaults"). */
  message?: string;
  saveLabel?: string;
  /** Hide Discard when there is nothing to discard (clean form, confirm-style bar). */
  showDiscard?: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-0 -mx-6 mt-8 flex items-center gap-3 border-t border-border bg-card/90 px-6 py-3 backdrop-blur md:-mx-8 md:px-8">
      <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-caution" /> {message}
      </span>
      {showDiscard && (
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
      )}
      <Button onClick={onSave} loading={saving}>{saveLabel}</Button>
    </div>
  );
}
