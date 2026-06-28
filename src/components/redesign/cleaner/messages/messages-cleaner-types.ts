import type { ConversationRowVM } from "@/components/redesign/messages/messages-types";
import type { OfficeContact } from "./office-contacts";

export type OfficeInboxMode = "loading" | "empty" | "single" | "inbox";

export interface OfficeInboxModel {
  mode: OfficeInboxMode;
  /** inbox mode: search-filtered, sorted conversation rows. */
  rows: ConversationRowVM[];
  /** single mode: the existing conversation id, or null when none exists yet. */
  singleConversationId: string | null;
  /** single mode: who the office thread is with (header avatar + send recipient). */
  singleContact: OfficeContact | null;
  /** single mode header title. */
  singleTitle: string;
  /** inbox mode: every office contact, for the "New message" compose picker, so the
   *  cleaner can start a thread with a SPECIFIC admin/manager, not just the default. */
  officeContacts: OfficeContact[];
  /** true when the org has no admin/manager to message at all. */
  noOfficeContacts: boolean;
}

export interface DeriveOfficeInboxInput {
  /** All of the cleaner's conversation rows, already mapped via toConversationRowVM
   *  by the Container (kept out of here so this module stays React-free). */
  rows: ConversationRowVM[];
  officeContacts: OfficeContact[];
  search: string;
  loading: boolean;
}
