import { describe, it, expect } from "vitest";
import { deriveOfficeInbox } from "./deriveOfficeInbox";
import type { DeriveOfficeInboxInput } from "./messages-cleaner-types";
import type { ConversationRowVM } from "@/components/redesign/messages/messages-types";
import type { OfficeContact } from "./office-contacts";

function row(over: Partial<ConversationRowVM> = {}): ConversationRowVM {
  return {
    id: "c1",
    participantId: "p1",
    name: "Jordan Lee",
    email: "jordan@x.co",
    role: "admin",
    initials: "JL",
    avatarUrl: null,
    preview: "Hi",
    timeLabel: "2m",
    unreadCount: 0,
    hasBooking: false,
    lastMessageAt: "2026-06-28T10:00:00.000Z",
    ...over,
  };
}

function office(over: Partial<OfficeContact> = {}): OfficeContact {
  return { id: "p1", name: "Jordan Lee", role: "admin", orgRole: "owner", avatarUrl: null, ...over };
}

function input(over: Partial<DeriveOfficeInboxInput> = {}): DeriveOfficeInboxInput {
  return { rows: [], officeContacts: [], search: "", loading: false, ...over };
}

describe("deriveOfficeInbox", () => {
  it("returns loading mode while loading", () => {
    expect(deriveOfficeInbox(input({ loading: true })).mode).toBe("loading");
  });

  it("returns empty (no office contacts) when there are no people at all", () => {
    const out = deriveOfficeInbox(input());
    expect(out.mode).toBe("empty");
    expect(out.noOfficeContacts).toBe(true);
  });

  it("collapses to a single Office thread when there is one office contact and no thread yet", () => {
    const out = deriveOfficeInbox(input({ officeContacts: [office({ id: "p1" })] }));
    expect(out.mode).toBe("single");
    expect(out.singleConversationId).toBeNull();
    expect(out.singleContact?.id).toBe("p1");
    expect(out.singleTitle).toBe("Office");
  });

  it("collapses to single and uses the existing conversation id when one thread exists", () => {
    const out = deriveOfficeInbox(
      input({ rows: [row({ id: "conv9", participantId: "p1" })], officeContacts: [office({ id: "p1" })] }),
    );
    expect(out.mode).toBe("single");
    expect(out.singleConversationId).toBe("conv9");
    expect(out.singleContact?.id).toBe("p1");
  });

  it("shows the inbox (sorted desc by lastMessageAt) with 2+ people", () => {
    const out = deriveOfficeInbox(
      input({
        rows: [
          row({ id: "a", participantId: "p1", lastMessageAt: "2026-06-28T09:00:00.000Z" }),
          row({ id: "b", participantId: "p2", name: "Mara", lastMessageAt: "2026-06-28T11:00:00.000Z" }),
        ],
        officeContacts: [office({ id: "p1" }), office({ id: "p2", name: "Mara", role: "manager" })],
      }),
    );
    expect(out.mode).toBe("inbox");
    expect(out.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out.officeContacts.map((o) => o.id)).toEqual(["p1", "p2"]);
  });

  it("is inbox (not single) when one thread exists but there are 2 office contacts to reach", () => {
    const out = deriveOfficeInbox(
      input({
        rows: [row({ id: "conv1", participantId: "p1" })],
        officeContacts: [office({ id: "p1" }), office({ id: "p2", name: "Mara", role: "manager" })],
      }),
    );
    expect(out.mode).toBe("inbox");
  });

  it("filters inbox rows by search (name)", () => {
    const out = deriveOfficeInbox(
      input({
        rows: [
          row({ id: "a", participantId: "p1", name: "Jordan" }),
          row({ id: "b", participantId: "p2", name: "Mara" }),
        ],
        officeContacts: [office({ id: "p1", name: "Jordan" }), office({ id: "p2", name: "Mara", role: "manager" })],
        search: "mar",
      }),
    );
    expect(out.rows.map((r) => r.name)).toEqual(["Mara"]);
  });

  it("does not strand an orphaned thread whose participant is no longer an office contact", () => {
    const out = deriveOfficeInbox(input({ rows: [row({ id: "conv1", participantId: "ex" })] }));
    expect(out.mode).toBe("single");
    expect(out.singleConversationId).toBe("conv1");
    expect(out.singleContact?.id).toBe("ex");
  });
});
