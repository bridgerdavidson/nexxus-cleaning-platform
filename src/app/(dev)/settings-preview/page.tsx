// src/app/(dev)/settings-preview/page.tsx
"use client";
import { useState } from "react";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorSettingsView } from "@/components/redesign/settings/OperatorSettingsView";
import { REDESIGN_SETTINGS_SECTIONS, type SettingsSectionId } from "@/components/redesign/settings/sections";

export default function SettingsPreviewPage() {
  const [activeId, setActiveId] = useState<SettingsSectionId>("profile");
  const active = REDESIGN_SETTINGS_SECTIONS.find((s) => s.id === activeId)!;
  return (
    <OperatorShell active="settings" onNewBooking={() => {}}>
      <OperatorSettingsView sections={REDESIGN_SETTINGS_SECTIONS} activeId={activeId} onSelectSection={setActiveId}>
        <div>
          <h2 className="text-lg font-bold text-foreground">{active.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Preview body for the {active.label} section.</p>
        </div>
      </OperatorSettingsView>
    </OperatorShell>
  );
}
