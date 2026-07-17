'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useProvisionTenant } from '@/hooks/usePlatformOrganizations';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type FieldErrors = { name?: string; ownerEmail?: string; billingEmail?: string };

/** Provision a new tenant org + email the founder an owner invite (existing route). */
export function ProvisionTenantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const provision = useProvisionTenant();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  function reset() {
    setName('');
    setOwnerEmail('');
    setBillingEmail('');
    setErrors({});
  }

  function computeErrors(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Organization name is required.';
    if (!ownerEmail.trim()) next.ownerEmail = 'An owner email is required.';
    else if (!EMAIL_RE.test(ownerEmail.trim())) next.ownerEmail = 'Enter a valid email address.';
    if (billingEmail.trim() && !EMAIL_RE.test(billingEmail.trim()))
      next.billingEmail = 'Enter a valid email address.';
    return next;
  }

  // Validate a single field on blur (don't flag fields the user hasn't reached yet).
  function blurField(field: keyof FieldErrors) {
    const all = computeErrors();
    setErrors((prev) => ({ ...prev, [field]: all[field] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const all = computeErrors();
    setErrors(all);
    const firstInvalid = (['name', 'ownerEmail', 'billingEmail'] as const).find((k) => all[k]);
    if (firstInvalid) {
      document.getElementById(`prov-${firstInvalid}`)?.focus();
      return;
    }
    try {
      await provision.mutateAsync({
        name: name.trim(),
        owner_email: ownerEmail.trim(),
        billing_email: billingEmail.trim() || undefined,
      });
      toast.success(`Provisioned ${name.trim()}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't provision the tenant.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provision tenant</DialogTitle>
          <DialogDescription>
            Create a cleaning company and email the founder an owner invite.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-2 grid gap-4" noValidate>
          <FormField label="Organization name" htmlFor="prov-name" required error={errors.name}>
            <Input
              id="prov-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => blurField('name')}
              placeholder="Sparkle Homes"
              autoFocus
            />
          </FormField>
          <FormField
            label="Owner email"
            htmlFor="prov-ownerEmail"
            required
            error={errors.ownerEmail}
            helper="The founder gets an owner invite at this address."
          >
            <Input
              id="prov-ownerEmail"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              onBlur={() => blurField('ownerEmail')}
              placeholder="founder@company.com"
              autoComplete="email"
            />
          </FormField>
          <FormField
            label="Billing email"
            htmlFor="prov-billingEmail"
            error={errors.billingEmail}
            helper="Optional. Defaults to the owner email."
          >
            <Input
              id="prov-billingEmail"
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              onBlur={() => blurField('billingEmail')}
              placeholder="billing@company.com"
              autoComplete="email"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={provision.isPending}>
              Provision tenant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
