"use client";
import { Switch } from "@/components/ui/switch";
import { useRailPreference } from "@/hooks/useRailPreference";
import { SettingRow, SectionHeader } from "../SettingRow";

/**
 * Per-user workspace layout preferences. Everything here is device-local and
 * applies instantly (no save bar): nothing writes to the database. The rail
 * preference lives here rather than in the rail itself, which carries
 * actionable nav only. The queued dark-mode toggle lands in this section too.
 */
export function AppearanceSection() {
  const { expanded, setExpanded } = useRailPreference();
  return (
    <div>
      <SectionHeader
        title="Appearance"
        lead="How the app is laid out for you. Saved on this device."
      />
      <SettingRow
        label="Keep sidebar open"
        htmlFor="appearance-rail-expanded"
        helper="Always show the full sidebar with labels on desktop. When off, it stays compact and expands while you point at it."
      >
        <Switch
          id="appearance-rail-expanded"
          checked={expanded}
          onCheckedChange={setExpanded}
        />
      </SettingRow>
    </div>
  );
}
