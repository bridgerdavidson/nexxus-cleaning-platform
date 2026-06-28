'use client';

/**
 * CleanerActiveJob — active-job container (the integration heart of Slice 3).
 *
 * Owns the local sub-screen stack (overview / before / checklist / after /
 * complete), the TWO photo upload managers (so in-flight uploads survive a
 * sub-screen unmounting), the photo gate, and the skip-with-reason flow. Sub-
 * screens are local state, NOT URL-addressed. Rendered inside the existing
 * CleanerJobDetailOverlay takeover (Task 11) for the `continue` action mode.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useImageUpload } from '@/hooks/useImageUpload';
import {
  useCleanerAppointments,
  useChecklist,
  useChecklistCompletions,
  useJobPhotosForAppointment,
  useOrgRequireJobPhotos,
  useSkipPhotos,
  useUpdateJobProgress,
} from '@/hooks/useCleanerData';
import { useOpenOfficeThread } from '@/hooks/useOpenOfficeThread';
import { deriveActiveJob } from './deriveActiveJob';
import { checklistProgressLabel, photoStatusLabel } from './active-job-presenters';
import type { ActiveJobScreen } from './active-job-types';
import { CleanerActiveJobView, type SectionSummary } from './CleanerActiveJobView';
import { CleanerPhotoCapture } from './CleanerPhotoCapture';
import { CleanerChecklistView } from './CleanerChecklistView';
import { CleanerCompleteSheet } from './CleanerCompleteSheet';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upload-manager item count still moving (excludes done + failed). */
function inProgressCount(items: { status: string }[]): number {
  return items.filter(
    (i) =>
      i.status === 'queued' ||
      i.status === 'converting' ||
      i.status === 'compressing' ||
      i.status === 'uploading',
  ).length;
}

/** Section card display for a photo phase. */
function photoSummary(confirmed: number, inProgress: number, needed: boolean, satisfied: boolean): SectionSummary {
  const status = photoStatusLabel(confirmed, inProgress);
  if (satisfied) return { status, pillText: 'Added', pillVariant: 'positive' };
  if (needed) return { status, pillText: 'Needed', pillVariant: 'caution' };
  return { status, pillText: 'Optional', pillVariant: 'outline' };
}

const PROGRESS_BY_SCREEN: Partial<Record<ActiveJobScreen, string>> = {
  before: 'before_photos',
  checklist: 'checklist',
  after: 'after_photos',
};

type SkipChoice = 'declined' | 'no_signal' | 'other';

// ---------------------------------------------------------------------------
// Skip-photos reason capture (container-owned)
// ---------------------------------------------------------------------------

function ReasonRow({ value, label }: { value: SkipChoice; label: string }) {
  return (
    <Label
      htmlFor={`skip-${value}`}
      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2"
    >
      <RadioGroupItem id={`skip-${value}`} value={value} />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </Label>
  );
}

function SkipPhotosDrawer({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
  submitting: boolean;
}) {
  const [choice, setChoice] = useState<SkipChoice>('declined');
  const [other, setOther] = useState('');

  // Reset to a clean form each time the drawer opens.
  useEffect(() => {
    if (open) {
      setChoice('declined');
      setOther('');
    }
  }, [open]);

  const reason =
    choice === 'declined' ? 'Customer declined' : choice === 'no_signal' ? 'No signal' : other.trim();
  const canSubmit = choice !== 'other' || other.trim().length > 0;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Can&apos;t add photos?</DrawerTitle>
          <DrawerDescription>
            Tell your operator why. The job can still be completed.
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-5 pb-1">
          <RadioGroup
            value={choice}
            onValueChange={(v) => setChoice(v as SkipChoice)}
            className="gap-2.5"
          >
            <ReasonRow value="declined" label="Customer declined" />
            <ReasonRow value="no_signal" label="No signal" />
            <ReasonRow value="other" label="Other" />
          </RadioGroup>

          {choice === 'other' && (
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="skip-other-reason">Reason</Label>
              <Textarea
                id="skip-other-reason"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="What happened?"
                maxLength={280}
                rows={3}
              />
            </div>
          )}
        </div>

        <DrawerFooter>
          <Button
            size="lg"
            className="w-full"
            disabled={!canSubmit || submitting}
            loading={submitting}
            onClick={() => onSubmit(reason)}
          >
            Skip photos
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export interface CleanerActiveJobProps {
  appointmentId: string;
  /** Closes the whole active-job takeover and returns to Today (clears ?job=). */
  onClose: () => void;
}

export function CleanerActiveJob({ appointmentId, onClose }: CleanerActiveJobProps) {
  const [screen, setScreen] = useState<ActiveJobScreen>('overview');
  const [skipOpen, setSkipOpen] = useState(false);

  // Appointment context (shared cache with Today/Schedule). useSkipPhotos
  // invalidates this list, so `photos_skipped` refreshes after a skip.
  const { appointments, loading } = useCleanerAppointments();
  const appointment = appointments.find((a) => a.id === appointmentId) ?? null;

  // require_job_photos from a query that actually SELECTs the column (the
  // AuthContext org object does not include it — see useOrgRequireJobPhotos).
  const requireJobPhotos = useOrgRequireJobPhotos();

  // Two upload managers owned HERE so in-flight uploads survive sub-screen nav.
  const beforeUploader = useImageUpload({
    context: { kind: 'job-photo', ctx: { appointmentId, photoType: 'before' } },
  });
  const afterUploader = useImageUpload({
    context: { kind: 'job-photo', ctx: { appointmentId, photoType: 'after' } },
  });

  const { beforePhotos, afterPhotos, refetch: refetchPhotos } =
    useJobPhotosForAppointment(appointmentId);

  const { lineItems } = useChecklist({
    checklistId: appointment?.checklist_id ?? null,
    serviceTypeId: appointment?.service_type_id ?? null,
  });
  const { completed } = useChecklistCompletions(appointmentId);

  const updateProgress = useUpdateJobProgress();
  const skipPhotos = useSkipPhotos();

  // "Message office": carry this job to the Messages tab so the cleaner picks WHO at
  // the office to message; the job attaches to whichever thread they open. Navigating
  // to Messages closes the active-job takeover (it clears ?job=).
  const { armForJob } = useOpenOfficeThread();
  const onMessageOffice = useCallback(() => armForJob(appointmentId), [armForJob, appointmentId]);

  // First-open progress advance (best-effort, loose order, non-blocking).
  const firedRef = useRef<Set<string>>(new Set());
  const openScreen = useCallback(
    (next: ActiveJobScreen) => {
      setScreen(next);
      const progress = PROGRESS_BY_SCREEN[next];
      if (progress && !firedRef.current.has(next)) {
        firedRef.current.add(next);
        updateProgress.mutate({ appointmentId, progress });
      }
    },
    [appointmentId, updateProgress],
  );

  const backToOverview = useCallback(() => setScreen('overview'), []);

  const handleSkipSubmit = useCallback(
    (reason: string) => {
      skipPhotos.mutate({ appointmentId, reason }, { onSuccess: () => setSkipOpen(false) });
    },
    [appointmentId, skipPhotos],
  );

  // ---- Gate + section summaries ----
  const beforeInProgress = inProgressCount(beforeUploader.items);
  const afterInProgress = inProgressCount(afterUploader.items);
  // A photo satisfies the gate when it is confirmed in the DB (beforePhotos) or
  // actively uploading (queued/converting/compressing/uploading). A 'done' item
  // is deliberately NOT counted here: it is already reflected in beforePhotos,
  // and counting it would keep the gate satisfied after the cleaner deletes the
  // persisted photo (the completed item lingers in uploader.items).
  const beforeSatisfied = beforePhotos.length > 0 || beforeInProgress > 0;
  const afterSatisfied = afterPhotos.length > 0 || afterInProgress > 0;

  const checklistDone = useMemo(
    () => lineItems.reduce((n, it) => (completed.has(it.id) ? n + 1 : n), 0),
    [lineItems, completed],
  );
  const checklistTotal = lineItems.length;

  const gate = deriveActiveJob({
    requireJobPhotos,
    photosSkipped: appointment?.photos_skipped ?? false,
    beforeSatisfied,
    afterSatisfied,
    checklistDone,
    checklistTotal,
  });

  const beforeSummary = photoSummary(beforePhotos.length, beforeInProgress, gate.beforeNeeded, beforeSatisfied);
  const afterSummary = photoSummary(afterPhotos.length, afterInProgress, gate.afterNeeded, afterSatisfied);
  const checklistSummary: SectionSummary = useMemo(() => {
    const status = checklistProgressLabel(checklistDone, checklistTotal);
    if (checklistTotal === 0) return { status, pillText: 'No tasks', pillVariant: 'outline' };
    if (checklistDone >= checklistTotal) return { status, pillText: 'Done', pillVariant: 'positive' };
    if (checklistDone === 0) return { status, pillText: 'To do', pillVariant: 'outline' };
    return { status, pillText: `${checklistDone}/${checklistTotal}`, pillVariant: 'info' };
  }, [checklistDone, checklistTotal]);

  // ---- Loading / not-found ----
  if (!appointment) {
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-6">
          {loading ? (
            <>
              <Skeleton className="h-24 w-full rounded-card" />
              <Skeleton className="h-16 w-full rounded-card" />
              <Skeleton className="h-16 w-full rounded-card" />
            </>
          ) : (
            <div className="pt-10">
              <EmptyState
                icon={<MapPin />}
                title="Job not available"
                description="This job may have been reassigned or is no longer on your schedule."
              />
              <div className="mt-6 flex justify-center">
                <Button variant="outline" onClick={onClose}>
                  Back to Today
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const showOverview = screen === 'overview' || screen === 'complete';

  return (
    <div className="flex h-full flex-col">
      {screen === 'before' && (
        <CleanerPhotoCapture
          phase="before"
          uploader={beforeUploader}
          confirmedPhotos={beforePhotos}
          onBack={backToOverview}
          onPhotosChange={refetchPhotos}
        />
      )}

      {screen === 'after' && (
        <CleanerPhotoCapture
          phase="after"
          uploader={afterUploader}
          confirmedPhotos={afterPhotos}
          onBack={backToOverview}
          onPhotosChange={refetchPhotos}
        />
      )}

      {screen === 'checklist' && (
        <CleanerChecklistView
          appointmentId={appointmentId}
          checklistId={appointment.checklist_id ?? null}
          serviceTypeId={appointment.service_type_id ?? null}
          onBack={backToOverview}
        />
      )}

      {showOverview && (
        <CleanerActiveJobView
          appointment={appointment}
          before={beforeSummary}
          checklist={checklistSummary}
          after={afterSummary}
          gate={gate}
          onOpen={openScreen}
          onComplete={() => setScreen('complete')}
          onSkipPhotos={() => setSkipOpen(true)}
          onMessageOffice={onMessageOffice}
        />
      )}

      {/* Complete sheet — mounted always; the drawer owns its open/close anim.
          Both callbacks are tolerant of a stray double call: onClose returns to
          the overview, onCompleted closes the whole takeover. */}
      <CleanerCompleteSheet
        open={screen === 'complete'}
        appointmentId={appointmentId}
        onClose={backToOverview}
        onCompleted={onClose}
      />

      <SkipPhotosDrawer
        open={skipOpen}
        onOpenChange={setSkipOpen}
        onSubmit={handleSkipSubmit}
        submitting={skipPhotos.isPending}
      />
    </div>
  );
}
