// src/components/redesign/settings/OperatorSettingsView.tsx
"use client";
import { cn } from "@/lib/utils";
import { REDESIGN_SETTINGS_GROUPS, type RedesignSettingsSection, type SettingsSectionId } from "./sections";

export function OperatorSettingsView({
  sections, activeId, onSelectSection, children,
}: {
  sections: RedesignSettingsSection[];
  activeId: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[1700px] space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
      </header>
      <div className="overflow-hidden rounded-card border border-border bg-card shadow-soft-sm md:flex">
        <SettingsIndex sections={sections} activeId={activeId} onSelect={onSelectSection} />
        <div className="min-w-0 flex-1 px-6 py-6 md:px-8 md:py-7">{children}</div>
      </div>
    </div>
  );
}

function SettingsIndex({
  sections, activeId, onSelect,
}: {
  sections: RedesignSettingsSection[];
  activeId: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
}) {
  return (
    <nav aria-label="Settings sections" className="border-b border-border p-3 md:w-60 md:shrink-0 md:border-b-0 md:border-r md:p-4">
      {REDESIGN_SETTINGS_GROUPS.map((group) => {
        const items = sections.filter((s) => s.group === group.id);
        if (!items.length) return null;
        return (
          <div key={group.id} className="mb-2 last:mb-0">
            <p className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{group.label}</p>
            <ul className="space-y-0.5">
              {items.map((section) => {
                const Icon = section.icon;
                const active = section.id === activeId;
                return (
                  <li key={section.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(section.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm font-medium transition-colors",
                        active ? "bg-brand-50 text-brand-700" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-brand-ink" : "text-muted-foreground")} />
                      <span className="truncate">{section.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
