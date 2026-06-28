"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useConversations } from "@/hooks/useConversations";
import { useCleanerAppointments } from "@/hooks/useCleanerData";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useOpenOfficeThread } from "@/hooks/useOpenOfficeThread";
import { toConversationRowVM } from "@/components/redesign/messages/messages-presenters";
import { deriveOfficeInbox } from "./deriveOfficeInbox";
import { filterOfficeContacts } from "./office-contacts";
import { cleanerApptToContactBookingVM } from "./messages-cleaner-presenters";
import { CleanerMessagesView } from "./CleanerMessagesView";
import { CleanerOfficePicker } from "./CleanerOfficePicker";
import { CleanerThread } from "./CleanerThread";

/**
 * Cleaner Messages: a collapsing office inbox. One office contact -> the Office
 * thread inline (the tab itself). Several -> a list + a "New message" picker so a
 * specific admin/manager is always reachable. Thread opens (rows/picker) go through
 * the ?thread=/?to= host mounted in the cleaner layout.
 */
export function CleanerMessages() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { conversations, loading: convLoading } = useConversations({ userId });
  const { members, loading: membersLoading } = useOrganizationMembers({ excludeCurrentUser: true });

  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const { openConversation, openWith } = useOpenOfficeThread();

  // A job "armed" from the active-job "Message office" button rides in via ?appointment=
  // and attaches to whichever thread the cleaner opens. We carry the raw param through
  // openConversation/openWith and resolve it for the inbox banner + the inline thread.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { appointments } = useCleanerAppointments();
  const appointmentParam = searchParams.get("appointment");
  const armedAppointment = useMemo(
    () => (appointmentParam ? appointments.find((a) => a.id === appointmentParam) ?? null : null),
    [appointmentParam, appointments],
  );
  const clearArm = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("appointment");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);
  const armedJobLabel = useMemo(() => {
    if (!armedAppointment) return null;
    const vm = cleanerApptToContactBookingVM(armedAppointment);
    return `${vm.service} · ${vm.dateLabel}`;
  }, [armedAppointment]);

  // "Message office" from a job lands here as ?compose=1 (+ ?appointment): pop the
  // office picker (bottom sheet) so the cleaner chooses who to message. Consume the
  // flag so it does not re-open on refresh/back; the ?appointment stays armed. (In
  // single-office mode the inline thread renders instead and the picker never shows.)
  const composeParam = searchParams.get("compose");
  useEffect(() => {
    if (!composeParam) return;
    setPickerOpen(true);
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("compose");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [composeParam, searchParams, router, pathname]);

  // Single-mode inline thread keyboard handling (composer above the on-screen keyboard).
  const kbdRef = useRef<HTMLDivElement>(null);
  useKeyboardInset(kbdRef);

  const officeContacts = useMemo(() => filterOfficeContacts(members), [members]);
  const rowsAll = useMemo(
    () => conversations.map((c) => toConversationRowVM(c, userId)),
    [conversations, userId],
  );
  const model = useMemo(
    () =>
      deriveOfficeInbox({
        rows: rowsAll,
        officeContacts,
        search,
        loading: convLoading || membersLoading,
      }),
    [rowsAll, officeContacts, search, convLoading, membersLoading],
  );

  // Single office contact: the Messages tab IS the Office thread. Render it as a
  // fixed surface below the top bar (4rem) and above the bottom nav, so both stay
  // visible/tappable; the composer lifts above the keyboard via --kbd.
  if (model.mode === "single" && model.singleContact) {
    return (
      <div
        ref={kbdRef}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), var(--kbd, 0px))" }}
        className="redesign-overlay fixed inset-x-0 top-16 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-lg flex-col bg-card"
      >
        <CleanerThread
          variant="inline"
          conversationId={model.singleConversationId}
          recipient={model.singleContact}
          armedAppointment={armedAppointment}
          onArmedConsumed={clearArm}
        />
      </div>
    );
  }

  return (
    <>
      <CleanerMessagesView
        mode={model.mode}
        rows={model.rows}
        noOfficeContacts={model.noOfficeContacts}
        search={search}
        onSearch={setSearch}
        onOpenRow={(id) => openConversation(id, appointmentParam ?? undefined)}
        onCompose={() => setPickerOpen(true)}
        armedJobLabel={armedJobLabel}
        onCancelArm={clearArm}
      />
      <CleanerOfficePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        contacts={model.officeContacts}
        onPick={(c) => {
          setPickerOpen(false);
          openWith(c.id, appointmentParam ?? undefined);
        }}
      />
    </>
  );
}
