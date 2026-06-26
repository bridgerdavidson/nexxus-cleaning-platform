import { Button } from "@/components/ui/button";

export function SettingsSaveBar({
  visible, saving, onSave, onDiscard,
}: { visible: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-0 -mx-6 mt-8 flex items-center gap-3 border-t border-border bg-card/90 px-6 py-3 backdrop-blur md:-mx-8 md:px-8">
      <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-caution" /> Unsaved changes
      </span>
      <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
      <Button onClick={onSave} loading={saving}>Save changes</Button>
    </div>
  );
}
