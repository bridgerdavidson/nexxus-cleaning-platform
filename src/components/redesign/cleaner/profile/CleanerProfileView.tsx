"use client";

import { Building2, List, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CleanerAvatarEditor } from "./CleanerAvatarEditor";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { ProfileRow } from "./ProfileRow";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

export interface CleanerProfileViewProps {
  initials: string;
  avatarUrl?: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneDisplay: string;
  onFirstName: (v: string) => void;
  onLastName: (v: string) => void;
  onPhone: (v: string) => void;
  isDirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onAvatarUploaded: (url: string) => void;
  showAvailability: boolean;
  onSignOut: () => void;
}

export function CleanerProfileView({
  initials,
  avatarUrl,
  email,
  firstName,
  lastName,
  phoneDisplay,
  onFirstName,
  onLastName,
  onPhone,
  isDirty,
  saving,
  onSave,
  onDiscard,
  onAvatarUploaded,
  showAvailability,
  onSignOut,
}: CleanerProfileViewProps) {
  return (
    <div className="space-y-6 pt-1">
      {/* Profile edit */}
      <section>
        <SectionLabel>Profile</SectionLabel>
        <div className="rounded-card border border-border bg-card p-4 shadow-soft-md">
          <CleanerAvatarEditor
            currentAvatarUrl={avatarUrl}
            initials={initials}
            onUploaded={onAvatarUploaded}
          />

          <div className="mt-5 space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="cp-first" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  First name
                </label>
                <Input
                  id="cp-first"
                  value={firstName}
                  onChange={(e) => onFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="cp-last" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Last name
                </label>
                <Input
                  id="cp-last"
                  value={lastName}
                  onChange={(e) => onLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label htmlFor="cp-phone" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Phone
              </label>
              <Input
                id="cp-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phoneDisplay}
                onChange={(e) => onPhone(e.target.value)}
                placeholder="(555) 555-5555"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Email</span>
              <div className="rounded-field border border-border bg-muted/50 px-3 py-2.5 text-[15px] font-medium text-muted-foreground">
                {email || "Not set"}
              </div>
              <p className="mt-1 px-1 text-xs text-muted-foreground">Contact your office to change it.</p>
            </div>
          </div>

          {isDirty && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-control border border-border bg-muted/50 px-3 py-2.5">
              <span className="text-sm font-semibold text-foreground">Unsaved changes</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>
                  Discard
                </Button>
                <Button size="sm" onClick={onSave} loading={saving}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Account */}
      <section>
        <SectionLabel>Account</SectionLabel>
        <ChangePasswordDialog email={email} />
      </section>

      {/* Availability (employee model placeholder) */}
      {showAvailability && (
        <section>
          <SectionLabel>Availability</SectionLabel>
          <div className="flex items-start gap-3 rounded-card border border-border bg-card p-4 shadow-soft-sm">
            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
              <Building2 className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-foreground">Coming soon</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Setting your weekly availability will live here. For now, your office schedules and
                assigns your jobs.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Catalog */}
      <section>
        <SectionLabel>Catalog</SectionLabel>
        <ProfileRow
          icon={List}
          title="Service catalog"
          subtitle="What each clean includes"
          href="/cleaner/profile/services"
        />
      </section>

      {/* Sign out */}
      <section className="pt-1">
        <Button
          variant="outline"
          onClick={onSignOut}
          className="w-full border-critical/30 bg-critical-50 text-critical hover:bg-critical-50 hover:text-critical"
        >
          <LogOut aria-hidden />
          Sign out
        </Button>
      </section>
    </div>
  );
}
