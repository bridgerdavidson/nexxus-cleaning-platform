// src/components/redesign/settings/OperatorSettings.tsx
"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { EmptyState } from "@/components/ui/empty-state";
import { deriveSettingsSections, DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from "./sections";
import { SettingsNavGuardProvider, type SettingsGuard } from "./SettingsNavGuard";
import { SettingsLeaveDialog } from "./SettingsLeaveDialog";
import { OperatorSettingsView } from "./OperatorSettingsView";
import { SECTION_COMPONENTS } from "./sections/registry";

export function OperatorSettings() {
  const { user, currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sections = useMemo(
    () => deriveSettingsSections(user?.role, currentOrgRole ?? undefined, permissions),
    [user?.role, currentOrgRole, permissions],
  );

  const requested = searchParams.get("section");
  const activeId: SettingsSectionId = sections.some((s) => s.id === requested)
    ? (requested as SettingsSectionId)
    : DEFAULT_SETTINGS_SECTION;

  const guardRef = useRef<SettingsGuard | null>(null);
  const register = useCallback((g: SettingsGuard | null) => { guardRef.current = g; }, []);
  const [pending, setPending] = useState<SettingsSectionId | null>(null);
  const [savingLeave, setSavingLeave] = useState(false);

  const navigateTo = useCallback((id: SettingsSectionId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", id);
    router.replace(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  const onSelectSection = useCallback((id: SettingsSectionId) => {
    if (id === activeId) return;
    if (guardRef.current?.isDirty) { setPending(id); return; }
    navigateTo(id);
  }, [activeId, navigateTo]);

  const confirmSave = useCallback(async () => {
    setSavingLeave(true);
    const ok = await guardRef.current?.save();
    setSavingLeave(false);
    if (ok && pending) { navigateTo(pending); setPending(null); }
  }, [pending, navigateTo]);
  const confirmDiscard = useCallback(() => { if (pending) navigateTo(pending); setPending(null); }, [pending, navigateTo]);
  const cancelLeave = useCallback(() => setPending(null), []);

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  if (!privileged && permsLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (sections.length === 0) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState icon={<ShieldAlert />} title="No settings available" description="Ask an owner or admin for access." />
      </div>
    );
  }

  const ActiveSection = SECTION_COMPONENTS[activeId];

  return (
    <SettingsNavGuardProvider register={register}>
      <OperatorSettingsView sections={sections} activeId={activeId} onSelectSection={onSelectSection}>
        <ActiveSection />
      </OperatorSettingsView>
      <SettingsLeaveDialog
        open={pending != null}
        saving={savingLeave}
        onSave={confirmSave}
        onDiscard={confirmDiscard}
        onCancel={cancelLeave}
      />
    </SettingsNavGuardProvider>
  );
}
