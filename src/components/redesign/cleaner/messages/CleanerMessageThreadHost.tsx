"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThreadHeader } from "@/components/redesign/messages/ThreadHeader";
import { ThreadSkeleton } from "@/components/redesign/messages/ThreadStates";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { replaceSearchShallow } from "@/lib/shallowSearch";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useStartConversation } from "@/hooks/useStartConversation";
import { useCleanerAppointments } from "@/hooks/useCleanerData";
import { MobileTakeover } from "@/components/redesign/shared/MobileTakeover";
import type { UserRole } from "@/types";
import { CleanerThread } from "./CleanerThread";
import { filterOfficeContacts, type OfficeContact } from "./office-contacts";

/**
 * Mounts the office thread takeover from URL params (layout sibling, like the job
 * host). `?thread=<convId>` opens an existing thread; `?to=<userId>` opens/starts a
 * thread with a specific office person; `?appointment=<id>` arms that job. Gated:
 * the heavy data hooks only mount when a thread is actually open.
 */
export function CleanerMessageThreadHost() {
  const searchParams = useSearchParams();
  const threadParam = searchParams.get("thread");
  const toParam = searchParams.get("to");
  if (!threadParam && !toParam) return null;
  return (
    <ThreadHostInner
      threadParam={threadParam}
      toParam={toParam}
      appointmentParam={searchParams.get("appointment")}
      fromParam={searchParams.get("from")}
    />
  );
}

function ThreadHostInner({
  threadParam,
  toParam,
  appointmentParam,
  fromParam,
}: {
  threadParam: string | null;
  toParam: string | null;
  appointmentParam: string | null;
  fromParam: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const { conversations } = useConversations({ userId });
  const { members } = useOrganizationMembers({ excludeCurrentUser: true });
  const { appointments } = useCleanerAppointments();
  const { startConversation } = useStartConversation();

  const officeContacts = useMemo(() => filterOfficeContacts(members), [members]);

  const recipient: OfficeContact | null = useMemo(() => {
    if (toParam) return officeContacts.find((o) => o.id === toParam) ?? null;
    if (threadParam) {
      const p = conversations.find((c) => c.id === threadParam)?.other_participant;
      if (!p) return null;
      return {
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Office",
        role: (p.role as UserRole) ?? "admin",
        orgRole: "",
        avatarUrl: p.avatar_url ?? null,
      };
    }
    return null;
  }, [toParam, threadParam, officeContacts, conversations]);

  // For ?to= get/create the conversation (idempotent). For ?thread= the id is the param.
  // `startConversation` is a fresh reference each render, so we guard with a ref to
  // fire the RPC ONCE per recipient (mirrors the operator deep-link's consumed-ref).
  // Without this, each successful start re-renders, the effect re-runs, and it loops.
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(threadParam);
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (toParam) {
      if (startedForRef.current === toParam) return;
      startedForRef.current = toParam;
      startConversation(toParam).then((res) => {
        if (res.success && res.conversationId) setResolvedConvId(res.conversationId);
      });
    } else {
      startedForRef.current = null;
      setResolvedConvId(threadParam);
    }
  }, [toParam, threadParam, startConversation]);

  const [armedConsumed, setArmedConsumed] = useState(false);
  const armedAppointment = useMemo(() => {
    if (armedConsumed || !appointmentParam) return null;
    return appointments.find((a) => a.id === appointmentParam) ?? null;
  }, [armedConsumed, appointmentParam, appointments]);

  // Close the thread back to the inbox (clears all thread params).
  const clearAll = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("thread");
    sp.delete("to");
    sp.delete("appointment");
    sp.delete("from");
    const qs = sp.toString();
    replaceSearchShallow(qs ? `${pathname}?${qs}` : pathname);
    setArmedConsumed(false);
  }, [pathname, searchParams]);

  // Opened from the active job (?from=<jobId>): the thread's back returns to that job.
  // REPLACE (not push) so the dismissed /messages?to=...&from=... entry is collapsed off
  // the back-stack; otherwise a gesture/hardware back would re-open the thread we just left.
  const backToJob = useCallback(() => {
    router.replace(`/cleaner?job=${fromParam}`, { scroll: false });
  }, [router, fromParam]);

  const clearArmed = useCallback(() => {
    setArmedConsumed(true);
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("appointment");
    replaceSearchShallow(`${pathname}?${sp.toString()}`);
  }, [pathname, searchParams]);

  return (
    <MobileTakeover
      key={threadParam ?? toParam ?? ""}
      onClosed={fromParam ? backToJob : clearAll}
      ariaLabel="Office conversation"
    >
      {(close) =>
        recipient ? (
          <CleanerThread
            variant="takeover"
            conversationId={resolvedConvId}
            recipient={recipient}
            onBack={close}
            backLabel={fromParam ? "Back to job" : undefined}
            armedAppointment={armedAppointment}
            onArmedConsumed={clearArmed}
          />
        ) : (
          <ThreadLoading onBack={close} backLabel={fromParam ? "Back to job" : undefined} />
        )
      }
    </MobileTakeover>
  );
}

function ThreadLoading({ onBack, backLabel }: { onBack: () => void; backLabel?: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Same chrome as the loaded thread (D5/D9/D16): real header, bubbles
          skeleton, centered column on desktop. */}
      <div className="mx-auto flex h-full min-h-0 w-full flex-col lg:max-w-lg">
        <ThreadHeader onBack={onBack} backLabel={backLabel} title="Office" />
        <div className="flex min-h-0 flex-1 flex-col justify-end px-5 py-4">
          <ThreadSkeleton />
        </div>
      </div>
    </div>
  );
}
