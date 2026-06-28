"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
    />
  );
}

function ThreadHostInner({
  threadParam,
  toParam,
  appointmentParam,
}: {
  threadParam: string | null;
  toParam: string | null;
  appointmentParam: string | null;
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
  const [resolvedConvId, setResolvedConvId] = useState<string | null>(threadParam);
  useEffect(() => {
    let cancelled = false;
    if (toParam) {
      setResolvedConvId(null);
      startConversation(toParam).then((res) => {
        if (!cancelled && res.success && res.conversationId) setResolvedConvId(res.conversationId);
      });
    } else {
      setResolvedConvId(threadParam);
    }
    return () => {
      cancelled = true;
    };
  }, [toParam, threadParam, startConversation]);

  const [armedConsumed, setArmedConsumed] = useState(false);
  const armedAppointment = useMemo(() => {
    if (armedConsumed || !appointmentParam) return null;
    return appointments.find((a) => a.id === appointmentParam) ?? null;
  }, [armedConsumed, appointmentParam, appointments]);

  const clearAll = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("thread");
    sp.delete("to");
    sp.delete("appointment");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setArmedConsumed(false);
  }, [router, pathname, searchParams]);

  const clearArmed = useCallback(() => {
    setArmedConsumed(true);
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("appointment");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  return (
    <MobileTakeover key={threadParam ?? toParam ?? ""} onClosed={clearAll} ariaLabel="Office conversation">
      {(close) =>
        recipient ? (
          <CleanerThread
            variant="takeover"
            conversationId={resolvedConvId}
            recipient={recipient}
            onBack={close}
            armedAppointment={armedAppointment}
            onArmedConsumed={clearArmed}
          />
        ) : (
          <ThreadLoading onBack={close} />
        )
      }
    </MobileTakeover>
  );
}

function ThreadLoading({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="size-6" />
        </button>
        <div className="text-sm font-bold text-foreground">Office</div>
      </div>
      <div className="grid flex-1 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading conversation" />
      </div>
    </div>
  );
}
