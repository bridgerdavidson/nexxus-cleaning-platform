'use client';

import { CreditCard, Home, LogOut, Receipt, Sparkles, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { ProfileRow } from '@/components/redesign/cleaner/profile/ProfileRow';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

export interface HomeownerAccountHubViewProps {
  showPaymentMethods: boolean;
  signOutOpen: boolean;
  signingOut: boolean;
  onSignOutOpenChange: (open: boolean) => void;
  onConfirmSignOut: () => void;
}

export function HomeownerAccountHubView({
  showPaymentMethods,
  signOutOpen,
  signingOut,
  onSignOutOpenChange,
  onConfirmSignOut,
}: HomeownerAccountHubViewProps) {
  return (
    <div className="space-y-6 pt-1">
      <header className="space-y-0.5">
        <h1 className="text-2xl font-extrabold leading-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, homes, and payments</p>
      </header>

      <section>
        <SectionLabel>Account</SectionLabel>
        <div className="space-y-2">
          <ProfileRow
            icon={User}
            title="Profile"
            subtitle="Name, photo, and password"
            href="/homeowner/account/profile"
          />
        </div>
      </section>

      <section>
        <SectionLabel>Your cleanings</SectionLabel>
        <div className="space-y-2">
          <ProfileRow
            icon={Home}
            title="Properties"
            subtitle="Homes we clean for you"
            href="/homeowner/account/properties"
          />
          {showPaymentMethods && (
            <ProfileRow
              icon={CreditCard}
              title="Payment methods"
              subtitle="Saved cards"
              href="/homeowner/account/payment-methods"
            />
          )}
          <ProfileRow
            icon={Receipt}
            title="Payment history"
            subtitle="Receipts for past cleanings"
            href="/homeowner/account/receipts"
          />
          <ProfileRow
            icon={Sparkles}
            title="Browse services"
            subtitle="What we offer"
            href="/homeowner/account/services"
          />
        </div>
      </section>

      <section className="pt-1">
        <Button
          variant="outline"
          onClick={() => onSignOutOpenChange(true)}
          className="w-full border-critical/30 bg-critical-50 text-critical hover:bg-critical-50 hover:text-critical"
        >
          <LogOut aria-hidden />
          Sign out
        </Button>
      </section>

      <Drawer open={signOutOpen} onOpenChange={(v) => !signingOut && onSignOutOpenChange(v)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Sign out?</DrawerTitle>
            <DrawerDescription>You will need to sign in again on this device.</DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button onClick={onConfirmSignOut} loading={signingOut} className="w-full">
              Sign out
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={signingOut}
              onClick={() => onSignOutOpenChange(false)}
            >
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
