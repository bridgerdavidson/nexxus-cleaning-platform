# Follow-up: Migrate modal backdrops to iOS 26-safe pattern

**Status:** open · **Priority:** low (hygiene / latent risk, not an active user-visible bug)
**Created in the same session as commit `8a387e3` (the MobileSidebar fix)**

## TL;DR

`MobileSidebar` (commit `8a387e3`) and the four side panels listed below already use the canonical iOS 26-safe backdrop pattern. The remaining ~22 dialog modals all *escape* the user-visible bug only because they early-return `null` on close (so Safari has no element to sample). They still have:

- No fade-out animation on the backdrop (snap-close).
- A latent regression risk: if anyone wraps one in a `<Transition>` or animates the close, the bg-having element will linger in the render tree and the iOS 26 safe-area tint bug will reappear.

The fix here is to **build a shared `<ModalBackdrop>` component** that bakes in the canonical pattern, then migrate the 22 modals to use it. This both eliminates the latent risk and gives every modal a smooth 300ms fade-out.

## Background (read first if you didn't write the original fix)

iOS 26 Safari's "Liquid Glass" toolbar tinting samples the `background-color` of `position: fixed` / `position: sticky` elements near the viewport edges to tint the toolbar and safe-area extensions. `theme-color` is ignored. `opacity: 0`, `pointer-events: none`, and `visibility: hidden` do **NOT** exclude an element from sampling — only render-tree absence does. Full reasoning + sources: `docs/mobile-safari-safe-area-debug-instructions.md` (sections "What's actually happening on iOS 26 (Liquid Glass)" and "Canonical pattern"). Memory entry: `feedback_ios26_safari_liquid_glass.md`.

The user-visible bug only manifests when **a fixed element with a non-transparent `background-color` is animating out (or stuck mounted) at the moment Safari re-samples**. The current 22 modals don't trigger that today because they unmount instantly on close. Don't treat this as urgent; treat it as "make the codebase wrong-by-default-safe".

## Triage of all 28 backdrop sites

`grep -n "bg-black/50\|bg-black bg-opacity-50" src/components/`

### Already canonical — leave alone

These use the `transition-colors` `bg-black/50 ↔ bg-transparent` pattern on an always-mounted wrapper:

| File | Line | Notes |
|---|---|---|
| `src/components/AppointmentSidePanel.tsx` | 555 | Reference implementation #1 |
| `src/components/CustomerDetailModal.tsx` | 222 | side panel |
| `src/components/DayDetailSidebar.tsx` | 136 | side panel |
| `src/components/PropertySidePanel.tsx` | 191 | side panel |
| `src/components/TeamMemberSidePanel.tsx` | 211 | side panel |
| `src/components/MobileSidebar.tsx` | (post-commit `8a387e3`) | Reference implementation #2 — uses delayed-unmount variant |

### Migrate to shared `<ModalBackdrop>`

All early-return-null centered/dialog modals using `fixed inset-0 bg-black/50` or `bg-black bg-opacity-50`:

| File | Line | Current pattern |
|---|---|---|
| `src/components/AddAppointmentModal.tsx` | 778 | bg-opacity-50 + transition-opacity |
| `src/components/AddCleanerModal.tsx` | 87 | bg-opacity-50 + transition-opacity |
| `src/components/AddCustomerModal.tsx` | 160 | bg-opacity-50 + transition-opacity |
| `src/components/AddPropertyModal.tsx` | 406 | bg-opacity-50 + transition-opacity |
| `src/components/AddTeamMemberModal.tsx` | 135 | bg-opacity-50 + transition-opacity |
| `src/components/ApprovePayoutModal.tsx` | 108 | plain bg-black/50 |
| `src/components/BulkActionConfirmModal.tsx` | 32 | plain bg-opacity-50 |
| `src/components/CancelConfirmModal.tsx` | 32 | plain bg-opacity-50 |
| `src/components/ChecklistFormModal.tsx` | 130 | plain bg-black/50 |
| `src/components/CleanerProfileModal.tsx` | 117 | bg-opacity-50 + transition-opacity |
| `src/components/ConfirmAvailabilityModal.tsx` | 169 | bg-opacity-50 + transition-opacity (modal A) |
| `src/components/ConfirmAvailabilityModal.tsx` | 261 | bg-opacity-50 + transition-opacity (modal B) |
| `src/components/CustomersPage.tsx` | 635 | inline modal |
| `src/components/DeleteChecklistModal.tsx` | 56 | plain bg-black/50 |
| `src/components/DeleteConfirmModal.tsx` | 35 | bg-opacity-50 + transition-opacity |
| `src/components/DeleteServiceModal.tsx` | 76 | plain bg-black/50 |
| `src/components/DesktopMenuDropdown.tsx` | 76 | desktop dropdown — `hidden md:block`, lower migration value |
| `src/components/ManagerPermissionsModal.tsx` | 257 | bg-opacity-50 + transition-opacity |
| `src/components/NewConversationModal.tsx` | 76 | `absolute inset-0` (not fixed) — verify if migration needed |
| `src/components/NoPhotosWarningModal.tsx` | 24 | bg-black/50 + backdrop-blur-sm |
| `src/components/RecordPaymentModal.tsx` | 232 | plain bg-black/50 |
| `src/components/RescheduleAppointmentModal.tsx` | 412 | bg-opacity-50 + transition-opacity |
| `src/components/ServiceFormModal.tsx` | 241 | plain bg-black/50 |

22 files, 23 backdrop instances total.

## Canonical pattern: build `src/components/ModalBackdrop.tsx`

The shared component should:

1. Mount on `isOpen=true`, defer animation start to the next frame (RAF) so a fade-in transition can run.
2. On `isOpen=false`, animate `bg-black/50 → bg-transparent` via `transition-colors duration-300 ease-in-out`.
3. After the 300ms transition, fully unmount via a timer.
4. Set `aria-hidden={!isOpen}`, `tabIndex={isOpen ? 0 : -1}`, and `pointer-events-none` when invisible.
5. Forward `onClick` for the click-to-close affordance.
6. Accept a `z` prop (default `z-40`) so callers that need a higher stack can override.
7. Optionally accept a `blur` prop to retain the existing `backdrop-blur-sm` on modals that use it.

Sketch:

```tsx
"use client";

import { useEffect, useState } from "react";

interface ModalBackdropProps {
  isOpen: boolean;
  onClick?: () => void;
  z?: string;       // tailwind z-* class; default "z-40"
  blur?: boolean;   // adds backdrop-blur-sm when true
}

export function ModalBackdrop({ isOpen, onClick, z = "z-40", blur = false }: ModalBackdropProps) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const r = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(r);
    }
    setIsVisible(false);
    const t = setTimeout(() => setShouldRender(false), 300);
    return () => clearTimeout(t);
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <button
      type="button"
      aria-label="Close"
      aria-hidden={!isOpen}
      tabIndex={isOpen ? 0 : -1}
      onClick={onClick}
      className={`fixed inset-0 ${z} transition-colors duration-300 ease-in-out ${
        blur ? "backdrop-blur-sm" : ""
      } ${isVisible ? "bg-black/50" : "bg-transparent pointer-events-none"}`}
    />
  );
}
```

Variant note: this gives both fade-in *and* fade-out (RAF dance). The reference `MobileSidebar.tsx` skips the RAF and only fades out, matching its prior UX. Either is correct for the bug; pick one and document the choice.

## Migration recipe (per modal)

For an existing modal that looks like:

```tsx
if (!isOpen) return null;
return (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div
      className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
      onClick={handleClose}
    />
    {/* dialog content */}
  </div>
);
```

Change to:

```tsx
return (
  <>
    <ModalBackdrop isOpen={isOpen} onClick={handleClose} z="z-40" blur />
    {isOpen && (
      <div className="fixed inset-0 z-50 overflow-y-auto pointer-events-none">
        <div className="pointer-events-auto ...">
          {/* dialog content */}
        </div>
      </div>
    )}
  </>
);
```

The dialog content can keep its early-return-null (it has bg-white, which is what we want for safe-area tint anyway). Only the bg-having backdrop needs the new pattern. Note `pointer-events-none/auto` to keep clicks falling through to the backdrop.

## Acceptance criteria

- [ ] `src/components/ModalBackdrop.tsx` exists with the props above and is exported.
- [ ] All 22 files in the migration table import + use `ModalBackdrop` instead of inline `fixed inset-0 bg-black/50` / `bg-black bg-opacity-50`.
- [ ] `grep -n "fixed inset-0 bg-black/50\|fixed inset-0 bg-black bg-opacity-50" src/components/` returns no matches outside `ModalBackdrop.tsx`, the four side panels, and `MobileSidebar.tsx`.
- [ ] `grep -n "bg-black/50\|bg-black bg-opacity-50" src/components/` returns matches only inside `ModalBackdrop.tsx` and the canonical files listed in the "leave alone" table.
- [ ] `npm run lint` and `npx tsc --noEmit` produce no new errors in the migrated files.
- [ ] Smoke-test on the iPhone (per `mobile-safari-safe-area-debug-instructions.md`): open and close at least three different migrated modals, confirm no gray tint persists in the safe-area zones.

## Out of scope

- The four side panels (`AppointmentSidePanel`, `CustomerDetailModal`, `DayDetailSidebar`, `PropertySidePanel`, `TeamMemberSidePanel`) already follow a working variant. Don't refactor them in this PR — track separately if they should also adopt the shared component.
- `DesktopMenuDropdown` (`hidden md:block`) does not paint into mobile safe areas. Migrate for consistency only, low priority.
- `NewConversationModal:76` uses `absolute inset-0` (not `fixed`) — verify whether it sits inside a `position: fixed` ancestor before assuming it's affected. If it's only ever inside a non-fixed flow, no migration needed.

## Pre-commit hygiene (optional)

Consider adding a Grep-based pre-commit check or ESLint rule that flags new occurrences of:

- `fixed inset-0 bg-black/50`
- `fixed inset-0 bg-black bg-opacity-50`

outside of the canonical files. This is the easiest way to prevent re-introducing the latent bug as the codebase grows.
