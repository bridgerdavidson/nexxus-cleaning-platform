"use client";
import { Switch } from "@/components/ui/switch";
import { ThemeSegmented } from "@/components/ui/theme-segmented";
import { useRailPreference } from "@/hooks/useRailPreference";
import { SettingRow, SectionHeader } from "../SettingRow";

/**
 * Per-user workspace layout preferences. Everything here is device-local and
 * applies instantly (no save bar): nothing writes to the database. The rail
 * preference lives here rather than in the rail itself, which carries
 * actionable nav only.
 */
export function AppearanceSection() {
  const { expanded, setExpanded } = useRailPreference();
  return (
    <div>
      <SectionHeader
        title="Appearance"
        lead="How the app looks and is laid out for you. Saved on this device."
      />
      <SettingRow
        label="Theme"
        helper="Choose light or dark, or follow your device setting."
      >
        <ThemeSegmented />
      </SettingRow>
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
