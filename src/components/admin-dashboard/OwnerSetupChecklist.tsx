'use client';

import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOrgQuery } from '@/lib/useOrgQuery';
import { supabase } from '@/lib/supabase';

interface SetupStatus {
  chargesEnabled: boolean;
  hasService: boolean;
  hasCleaner: boolean;
}

/**
 * First-run checklist for a cleaning-company OWNER (org_role='owner'), shown on
 * the admin-dashboard home tab. Links to existing surfaces; done-state is read
 * live from the org's data. Hides itself once all three steps are complete.
 * `onNavigate` switches the dashboard tab.
 */
export default function OwnerSetupChecklist({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const { currentOrgRole, currentOrganization } = useAuth();

  const { data } = useOrgQuery<SetupStatus>({
    queryKey: ['owner-setup', currentOrganization?.id ?? 'none'],
    enabled: currentOrgRole === 'owner',
    queryFn: async ({ orgId }) => {
      const [orgRes, svcRes, cleanerRes] = await Promise.all([
        supabase
          .from('organizations')
          .select('stripe_connect_charges_enabled')
          .eq('id', orgId)
          .maybeSingle(),
        supabase
          .from('service_types')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId),
        supabase
          .from('organization_members')
          .select('user_id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('role', 'cleaner'),
      ]);
      const orgRow = orgRes.data as { stripe_connect_charges_enabled?: boolean } | null;
      return {
        chargesEnabled: !!orgRow?.stripe_connect_charges_enabled,
        hasService: (svcRes.count ?? 0) > 0,
        hasCleaner: (cleanerRes.count ?? 0) > 0,
      };
    },
  });

  if (currentOrgRole !== 'owner' || !data) return null;

  const steps = [
    {
      key: 'stripe',
      done: data.chargesEnabled,
      title: 'Connect payments',
      desc: 'Set up Stripe so you can charge customers and pay your cleaners.',
      cta: 'Connect',
      tab: 'settings',
    },
    {
      key: 'service',
      done: data.hasService,
      title: 'Add a service',
      desc: 'Create at least one service customers can book.',
      cta: 'Add service',
      tab: 'services',
    },
    {
      key: 'cleaner',
      done: data.hasCleaner,
      title: 'Invite a cleaner',
      desc: 'Bring your team on board so jobs can be assigned.',
      cta: 'Invite',
      tab: 'invites',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <section
      aria-label="Set up your business"
      className="rounded-2xl border border-primary-200 bg-primary-50/60 p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-secondary-900">
            Finish setting up {currentOrganization?.name ?? 'your business'}
          </h3>
          <p className="mt-0.5 text-sm text-secondary-600">
            A few steps before you can take bookings.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold tabular-nums text-secondary-600">
          {doneCount}/{steps.length}
        </span>
      </div>

      <ul className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm"
          >
            {step.done ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden="true" />
            ) : (
              <Circle className="h-5 w-5 shrink-0 text-secondary-300" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-semibold ${
                  step.done ? 'text-secondary-400 line-through' : 'text-secondary-900'
                }`}
              >
                {step.title}
              </p>
              {!step.done && <p className="text-xs text-secondary-500">{step.desc}</p>}
            </div>
            {step.done ? (
              <span className="shrink-0 text-xs font-medium text-green-600">Done</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(step.tab)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                {step.cta}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
