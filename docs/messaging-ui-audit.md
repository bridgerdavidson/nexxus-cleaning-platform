# Messaging UI audit (MASTER-TODO 3.9.1)

Date: 2026-08-10. Status: audit complete; this doc is the working spec for 3.9.2 (unify).

The conversations UI evolved per-role and no longer reads as one product. The operator inbox
(`src/components/redesign/messages/**`) is the gold standard; cleaner and homeowner surfaces
keep their **structure** (appointment-based threads, phone-first layouts) but must adopt its
**visual language**. This audit inventories every surface, catalogs the drift at the class
level, and states the adoption decision for each hotspot.

**Repro / evidence.** Seed a full three-role cast locally with
`node --env-file=.env.local scripts/seed-demo.mjs`, then sign in as
`sarah.chen@` / `diana.ruiz@` / `jessica.palmer@brightnest.demo` (`DemoPass123!`).
Screenshot matrix captured 2026-08-10 across desktop (1440) and mobile (390) for every role's
list + thread + embedded surfaces.

## 1. The good news: the core is already shared

`MessageBubble`, `MessageComposer`, `MessageThreadTakeoverView`, `MobileTakeover`, the
message/conversation hooks, and the presenter layer (`toMessageVM`, `toConversationRowVM`) are
single implementations consumed by all three roles. The drift is concentrated in the chrome
AROUND them: inbox rows and lists, thread headers, unread indicators, compose pickers, empty
and loading states, section labels, and date/time formatting. That makes 3.9.2 smaller than it
looked: it is primitive-extraction plus re-skinning, not a thread rewrite.

## 2. Surface inventory (where everything lives)

**Operator** (`src/app/(redesign)/admin/messages/page.tsx` → `OperatorMessages` →
`OperatorMessagesView`): `InboxList` + `ConversationRow` + `JobThreadInboxRow` (list),
`MessageThreadPanel` (office threads), `OperatorJobThreadPane` + `JobThreadTranscript`
(read-only job threads), `ContextPanel`, `NewMessageDialog`, `ReferenceBookingMenu`,
`InlineBookingCard`.

**Cleaner** (`.../cleaner/messages/page.tsx` → `CleanerMessages` → `CleanerMessagesView` with
sectioned Office / Your cleanings / Past): `CleanerConversationRow` (trimmed copy of
`ConversationRow`), `CleanerThread` / `CleanerJobThread` (both delegate to
`MessageThreadTakeoverView`), `CleanerMessageThreadHost` / `CleanerJobThreadHost` (URL hosts,
mounted in the cleaner layout), `CleanerOfficePicker`. Secondary entry: active-job screen.

**Homeowner** (`.../homeowner/messages/page.tsx` → `HomeownerMessages` →
`HomeownerMessagesView`): card-style `OfficeRow`/`JobRow` + hand-rolled `UnreadPill`,
`HomeownerMessageThread` (delegates to `MessageThreadTakeoverView`),
`HomeownerMessageThreadHost`, `NewConversationSheet`. Secondary entry: cleaning detail.
Note: the homeowner tree imports `office-contacts.ts` from the **cleaner** tree.

**Embedded**: `bookings/JobMessagesPanel` (booking-detail sheet, reuses `JobThreadTranscript`),
`cleaner/earnings/PayRequestThreadSheet` (a negotiation ledger, NOT a chat — excluded from
bubble unification), `MessageAttachmentsLightbox` (shared, only reachable via `MessageBubble`),
`NavMessagesBadge` (primitive used only by operator; cleaner/homeowner bottom navs inline the
identical class string), `marketing/CapabilityExplorer` mock bubbles (out of scope, marketing).

**Dev**: `(dev)/messages-preview` renders `OperatorMessagesView` with fixtures (its clock-time
fixtures do not match production's relative labels; update alongside 3.9.2).

## 3. Drift hotspots and adoption decisions

Numbered decisions; "adopt" always means the admin vocabulary unless stated. Exact current
class strings are in the inventory notes; file:line refs verified 2026-08-10.

| # | Hotspot | Decision for 3.9.2 |
|---|---------|--------------------|
| D1 | **Inbox rows.** Homeowner uses floating cards (`rounded-card border bg-card p-4 shadow-soft-sm`, `space-y-2.5`, `hover:bg-muted/50`, no press state); admin/cleaner use a flush bordered list (`border-b border-border/60 px-4 py-3`, `active:bg-accent hover:bg-accent/60`). | Extract admin `ConversationRow` into a shared primitive with slots (status badge, third line, no-avatar icon-tile variant for the Office row). Homeowner re-skins onto the flush list (`ListShell` pattern from `CleanerMessagesView`). Delete `CleanerConversationRow` + homeowner `ROW_BASE`. |
| D2 | **Unread indicator.** Admin/cleaner: `Badge` pill (`bg-primary/10 text-primary`, `text-[10px]`). Homeowner `UnreadPill`: raw `bg-brand-600 text-white text-[11px]`. Only cleaner/homeowner have `sr-only` counts. | One Badge-based pill in the shared row. Adopt the `sr-only` count everywhere (admin gains it). Kill `UnreadPill`. |
| D3 | **Row typography.** Name `text-[15px] font-bold leading-tight` (admin/cleaner) vs `text-sm font-bold` (homeowner); preview `text-[13px]` vs `text-sm`; time `text-[11px]` with `tabular-nums` only on cleaner/homeowner. | Admin name/preview sizes everywhere; adopt `tabular-nums` on times everywhere (admin gains it). |
| D4 | **Selection state.** Admin office rows: `aria-pressed` + `bg-accent` + 3px left rail. Admin job rows use a different idiom (`border-l-2` + `bg-primary/5`). Cleaner/homeowner: none (takeover nav, fine). | One idiom: the rail + `bg-accent`. `JobThreadInboxRow` adopts it (and renders its already-populated `unreadCount`). |
| D5 | **Thread headers, 3.5 copies.** `MessageThreadPanel` (`border-border/60 px-3 py-2.5`, `IconButton` + `ArrowLeft size-5`), `MessageThreadTakeoverView` (`border-border px-2 py-2`, raw button + `ChevronLeft size-6`), `OperatorJobThreadPane` (copies panel), `CleanerMessageThreadHost` loading header (copies takeover, `gap-2`). | One `ThreadHeader` primitive (back slot, avatar slot, title, subtitle, actions slot). Panel spacing/border wins; back = `IconButton` + `ArrowLeft size-5` at both breakpoints. All four call sites adopt it, including the host loading fallbacks. |
| D6 | **Off-token styling.** Admin Details button: raw `border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100` in a template string. | Re-token (`bg-accent text-accent-foreground` family or Button `variant="outline"` + primary ink). No raw `brand-*` in messaging surfaces. |
| D7 | **Bubbles, three renderers.** Canonical `MessageBubble` (`rounded-card` + `rounded-br-sm`/`rounded-bl-sm` tails, own `bg-primary`, other `border bg-card`, `max-w-[78%]`, `px-3.5 py-2`). `JobThreadTranscript` (`bg-primary/10` / `bg-muted`, no tails, no border, `max-w-[85%]`, `px-3 py-2`). Marketing mock (top-corner tails). | `JobThreadTranscript` keeps its structure (sender-name labels above, side-by-participant: it is an observer view of two OTHER people) but adopts `MessageBubble`'s geometry (`rounded-card` + bottom tails, padding, `max-w-[78%]`) and border treatment; tint-by-participant stays as the differentiator (documented variant). Marketing mock untouched (not product). |
| D8 | **Empty states, five languages.** `EmptyState` primitive in the inboxes; hand-rolled columns in `MessageThreadTakeoverView` and `JobThreadTranscript` (the latter has no title); bare `<p>` in both pickers; icon sizes drift (`size-10` default vs `size-5`/`size-6`). | `EmptyState` primitive everywhere it fits; one compact thread-empty variant (icon `size-6`, title + body) shared by takeover + transcript; pickers get the primitive's compact form. One icon-size rule: `size-10` for page-level, `size-6` for in-thread. |
| D9 | **Loading, five skeleton languages + three load-more spinners.** Row skeletons: `size-10` avatar (real avatar is `size-11`) / `h-16 rounded-card` / `h-7`+`h-20` mixes. Thread skeletons already match (panel/takeover); transcript drifts (`h-9`, `ml-auto`). Load-more: `Loader2` vs `Skeleton h-4 w-16`. Host fallbacks: fake header w/ spinner vs bare spinner. | One row-skeleton (avatar `size-11` + two text lines) and one thread-skeleton (the existing panel/takeover one; transcript adopts). Load-more = `Loader2 size-4` everywhere. Host fallbacks render `ThreadHeader` + thread-skeleton (kills the hand-rolled fake header). |
| D10 | **Time semantics.** Three `timeAgo` impls (`messages-format`, local copy in `jobThreadRow` that diverges past 7d, and the shared one), two `dayLabel`s (only `jobTranscript`'s knows "Yesterday"), clock formatter with and without `hour12`, four copies of the `weekday/month/day` literal. | Consolidate into `messages-format.ts`: one `timeAgo`, one `dayLabel` (WITH "Yesterday" — adopt the better transcript version), one `fmtTime` (`hour12: true`), one `weekdayMonthDay`. Bubbles keep relative time; the read-only transcript keeps absolute clock time (deliberate: it is an audit trail) but uses the shared formatter. |
| D11 | **Compose pickers, three shells.** Admin `NewMessageDialog` (Dialog, search, `EmptyState`); cleaner `CleanerOfficePicker` (Drawer, no search, bare empty); homeowner `NewConversationSheet` (Drawer, card rows, bare empty). Triggers: `+` primary IconButton vs filled `New` Button vs ghost `PenSquare`. | One responsive `PersonPicker` primitive (Dialog on desktop / Drawer on mobile, optional search + optional static options slot for "Cleaning office"). All three adopt. **Decided (2026-08-10):** trigger unifies on the primary `+` icon-button vocabulary (with visible label where the layout has room, e.g. cleaner's sectioned page); the homeowner's `PenSquare` compose icon is retired. |
| D12 | **Section labels, five specs.** `text-[11px]`/`text-xs`/`text-[13px]` × `font-semibold`/`font-bold` × `tracking-[0.04em]`/`tracking-wide`, and cleaner/homeowner's non-uppercase `SectionHeader` duplicated byte-identically in both trees. | Two sanctioned levels only: page-section header (the cleaner/homeowner `SectionHeader`, extracted once and shared) and micro-label (`text-[11px] font-semibold uppercase tracking-[0.04em]`, the InboxList spec). Everything else maps to one of those. |
| D13 | **Role/status pills.** `ROLE_LABEL` declared 3×; role pill hand-rolled 2 different ways; three booking-status maps disagree on label AND variant (`confirmed` = Confirmed/secondary vs Scheduled/default; `completed` = Completed vs "All done"; variants scattered). | One `ROLE_LABEL` + one Badge-based role pill in the shared module. Status VARIANTS unify to one semantic map (source: bookings-presenters BADGE map, the app-wide status-color source of truth). **Decided (2026-08-10):** role-voiced COPY stays ("All done" for cleaners, "Scheduled" where the role says it that way); only color/variant unifies. The shared map is therefore keyed `status -> variant`, with copy supplied per role. |
| D14 | **Nav unread badge.** `NavMessagesBadge` primitive exists but its exact class string is re-inlined in `OperatorRail`, `OperatorMobileNav`, `CleanerBottomNav`, `HomeownerBottomNav`. | All four call sites import the primitive. |
| D15 | **Hit-area / a11y.** `touch-manipulation` missing on homeowner rows; `focus-visible:ring` missing on admin/cleaner rows; `min-h-[44px]` only in one picker; admin unread pill has no `sr-only`. | The shared row primitive carries all of them: `touch-manipulation`, `focus-visible:ring-2 ring-ring`, 44px min hit area, `sr-only` unread. |
| D16 | **Desktop width of takeover threads** (screenshot finding). Cleaner/homeowner threads render inside `MobileTakeover` (`fixed inset-0`) with no width cap: at 1440px, bubbles span the full viewport edge to edge. Operator avoids this via its two-pane desktop layout (`desktopHidden`). | **Decided (2026-08-10): cap and center.** The takeover thread body gets a centered `max-w` column at `lg:` (reusing the shells' phone-column convention), so header, transcript, and composer share one axis and a homeowner on a laptop gets composed line lengths. Cheap inside `MessageThreadTakeoverView`. |

**Dead code to sweep in 3.9.2** (all verified): `ContextPanelBody` export (unused),
`InboxList.totalConversations` prop (passed, never read), `MessageThreadTakeoverView.variant`
prop (passed by all three consumers, never read), `JobThreadRowVM.unreadCount` (populated,
never rendered — D4 renders it instead of deleting).

## 4. Suggested PR slicing for 3.9.2

1. **PR A — invisible consolidation.** `messages-format.ts` becomes the single time/format
   module (D10); dead-code sweep; `NavMessagesBadge` adoption (D14). Zero visual change, easy
   review, unblocks everything.
2. **PR B — primitives + operator adoption.** `ThreadHeader` (D5), shared `ConversationRow` +
   row skeleton + empty-state variants (D1, D8, D9), `PersonPicker` (D11), role/status pill
   module (D13), re-token the Details button (D6), transcript bubble geometry (D7), admin
   gains `sr-only`/`tabular-nums`/focus rings (D2, D3, D15). Operator screens are the proof
   the primitives cover the gold standard.
3. **PR C — cleaner + homeowner re-skin.** Both trees adopt the primitives (D1-D3, D8, D9,
   D11, D12, D15), homeowner cards → flush list, takeover desktop width cap (D16). This is
   the user-visible PR; before/after screenshots per role in the PR body.

Design-system rules apply throughout (`ui-feature-workflow`; `ui-ux-pro-max` conformance pass
at implementation). Structural non-goals: cleaner/homeowner stay appointment-sectioned and
takeover-based; the operator keeps its two-pane console; `PayRequestThreadSheet` stays a
ledger; marketing mock untouched.

## 5. Product decisions (settled 2026-08-10)

All three open calls are answered; no blockers remain for 3.9.2.

1. **Status copy** (D13): **keep the role voice.** A cleaner still sees "All done" and each role
   keeps the wording that fits how it talks about a job. Only the color/variant unifies, so the
   shared map carries semantics, not strings.
2. **Takeover desktop cap** (D16): **cap and center.** Cleaner/homeowner threads get a centered
   column on desktop instead of stretching edge to edge.
3. **Trigger affordance** (D11): **unify on `+`.** The homeowner's `PenSquare` compose icon is
   retired in favor of the primary `+` icon-button used everywhere else.
