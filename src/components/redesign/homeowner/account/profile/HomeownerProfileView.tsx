'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AvatarEditor } from '@/components/redesign/shared/AvatarEditor';
import { ChangePasswordDialog } from '@/components/redesign/cleaner/profile/ChangePasswordDialog';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

export interface HomeownerProfileViewProps {
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
}

export function HomeownerProfileView({
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
}: HomeownerProfileViewProps) {
  return (
    <div className="space-y-6 pt-1">
      <section>
        <SectionLabel>Profile</SectionLabel>
        <div className="rounded-card border border-border bg-card p-4 shadow-soft-md">
          <AvatarEditor currentAvatarUrl={avatarUrl} initials={initials} onUploaded={onAvatarUploaded} />

          <div className="mt-5 space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="hp-first" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  First name
                </label>
                <Input
                  id="hp-first"
                  value={firstName}
                  onChange={(e) => onFirstName(e.target.value)}
                  autoComplete="given-name"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="hp-last" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Last name
                </label>
                <Input
                  id="hp-last"
                  value={lastName}
                  onChange={(e) => onLastName(e.target.value)}
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label htmlFor="hp-phone" className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Phone
              </label>
              <Input
                id="hp-phone"
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
                {email || 'Not set'}
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

      <section>
        <SectionLabel>Account</SectionLabel>
        <ChangePasswordDialog email={email} />
      </section>
    </div>
  );
}
