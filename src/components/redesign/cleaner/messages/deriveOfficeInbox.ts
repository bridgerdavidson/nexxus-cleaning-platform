// React-free: decides the cleaner Messages screen mode (single Office thread vs a
// list of office people) and prepares the inbox rows. The Container pre-maps
// conversations to ConversationRowVM[] (via toConversationRowVM) before calling this.
import { deriveMessages } from "@/components/redesign/messages/deriveMessages";
import type { ConversationRowVM } from "@/components/redesign/messages/messages-types";
import type { OfficeContact } from "./office-contacts";
import type { DeriveOfficeInboxInput, OfficeInboxModel } from "./messages-cleaner-types";

const OFFICE_TITLE = "Office";

/** Minimal OfficeContact for an existing thread whose participant is not (or no
 *  longer) in the current office contact list, so a thread is never stranded. */
function officeFromRow(row: ConversationRowVM): OfficeContact {
  return { id: row.participantId, name: row.name, role: row.role, orgRole: "", avatarUrl: row.avatarUrl };
}

export function deriveOfficeInbox(input: DeriveOfficeInboxInput): OfficeInboxModel {
  const { rows, officeContacts, search, loading } = input;

  const base: OfficeInboxModel = {
    mode: "loading",
    rows: [],
    singleConversationId: null,
    singleContact: null,
    singleTitle: OFFICE_TITLE,
    officeContacts,
    noOfficeContacts: officeContacts.length === 0,
  };
  if (loading) return base;

  // Reachable people = office contacts unioned with existing-conversation
  // participants, so an orphaned former-admin thread is still reachable.
  const peopleIds = new Set<string>(officeContacts.map((o) => o.id));
  for (const r of rows) if (r.participantId) peopleIds.add(r.participantId);

  if (peopleIds.size === 0) {
    return { ...base, mode: "empty", noOfficeContacts: true };
  }

  if (peopleIds.size === 1) {
    const onlyId = [...peopleIds][0];
    const row = rows.find((r) => r.participantId === onlyId) ?? null;
    const singleContact =
      officeContacts.find((o) => o.id === onlyId) ?? (row ? officeFromRow(row) : null);
    return { ...base, mode: "single", singleConversationId: row?.id ?? null, singleContact };
  }

  // 2+ people: a real inbox. Reuse the operator search/sort (unreadOnly + roleFilter unused).
  const filtered = deriveMessages(rows, { search, unreadOnly: false, roleFilter: "all" });
  return { ...base, mode: "inbox", rows: filtered };
}
