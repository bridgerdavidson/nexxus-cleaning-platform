"use client";

import { stripeSelfPayUiEnabled } from "@/lib/stripe/flags";
import OrgPaymentMethodPicker from "./OrgPaymentMethodPicker";

/**
 * Settings → Payments section for the org's self-pay company payment methods. Behind
 * stripeSelfPayUiEnabled(). Wraps the shared OrgPaymentMethodPicker (the same component used in the
 * booking modal's self-pay step) in the settings section chrome, so the org can keep MULTIPLE cards
 * and bank accounts, choose which one is charged, add a new card or bank, and remove one.
 */
export default function OrgPaymentMethodSection({ organizationId }: { organizationId: string }) {
  if (!stripeSelfPayUiEnabled()) return null;

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">Company payment methods</h2>
        <p className="text-sm text-gray-500">
          The card or bank account we charge when your organization books and pays for a cleaning
          itself (self-pay). Pick which one is charged, or add another.
        </p>
      </div>
      <OrgPaymentMethodPicker organizationId={organizationId} />
    </section>
  );
}
