# FlowShowcase Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the landing hero's left and right surfaces read as phones instead of cards, and bring all three surfaces to one fidelity level.

**Architecture:** Three shared primitives in `src/components/marketing/frames.tsx` gain chrome (`PhoneFrame`), an opt-in app bar (`BrowserFrame`), and an opt-in real-nav variant (`MiniRail`). `FlowShowcase` re-lays its fixed-coordinate stage, lifts role labels out of the frames onto a shared baseline above them, re-fits the cards inside, and re-cuts the two Bézier flight paths against measured anchor positions. `LiveTrackingSection` picks up the same phone chrome.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v3, `motion/react`, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-15-flow-showcase-chrome-design.md`. Read it before Task 1. The Decision Log at the bottom records seven things that were tried and found wrong; do not re-derive them.

## Global Constraints

- **Design system only.** Every visual comes from `src/components/ui/*` primitives and the tokens in `tailwind.config.js` / `src/app/globals.css`. No raw hex. Radius scale: `chip`=10px, `control`=14px, `field`=18px, `card`=22px, `pill`=9999px. Shadows: `soft-sm` / `soft-md` / `soft-lg`. Brand ramp: `brand-600` = `#0150FC`.
- **The companion mockups under `.superpowers/brainstorm/78863-1784097613/` are UX/structure reference ONLY.** They use inline hex because they are throwaway HTML. Never copy their styling.
- **No em dashes** in any user-facing copy (UI text, labels). Use `·`, a comma, or a period.
- **Marketing pages are light-only.** The `(marketing)` layout has no ThemeProvider. Do not add `dark:` variants.
- **Stage is 1060 x 420 design px.** Everything positions inside it.
- **`npx tsc --noEmit` has 12 pre-existing errors.** That is the baseline. Introduce none.
- **Dev server runs on :3100** in this worktree (`npm run dev -- --port 3100`). Port 3000 belongs to another session. The landing page is at `http://localhost:3100/landing`.
- **Verification is visual.** There are no unit tests for `src/components/marketing/**` and this plan does not add any: the deliverable is a 24-second animation whose failure modes are "the card lands 40px short" and "that reads as a skeleton". Those are not assertable cheaply or meaningfully. Every task ends with a browser check instead, and each names exactly what to look at.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/components/marketing/frames.tsx` | The three shared vignette primitives. Owns chrome, not content, not size. | 1, 2, 3 |
| `src/components/marketing/FlowShowcase.tsx` | The hero stage: geometry, labels, surfaces, travelling card, paths. | 4, 5, 6 |
| `src/components/marketing/LiveTrackingSection.tsx` | The "watch it live" phone vignette. | 7 |

`frames.tsx` has three consumers and only two of them change. `CapabilityExplorer.tsx` must keep its current appearance; that is why Tasks 2 and 3 add **opt-in** props defaulting to today's behaviour rather than changing them outright.

---

### Task 1: PhoneFrame gains real mobile chrome

**Files:**
- Modify: `src/components/marketing/frames.tsx:29-45` (the `PhoneFrame` function)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PhoneFrame({ initials, tabs, className, children })`.
  - `initials: string` — avatar text, e.g. `"SK"`.
  - `tabs: LucideIcon[]` — the bottom-nav icons. First one renders active.
  - `className?: string` — **the consumer owns the box** (width AND height). PhoneFrame sets no size.
  - `children: React.ReactNode` — surface content, rendered in a flex-1 body.
  - Tasks 4 and 7 both call this.

**Why `className` owns the box:** hardcoding 220x380 here would drag LiveTracking's 288px phone to ~490px tall and strand its gradient card in dead space. See spec, "Component changes".

- [ ] **Step 1: Replace `PhoneFrame`**

Replace lines 29-45 of `src/components/marketing/frames.tsx`:

```tsx
/** Phone-shell wrapper for mobile vignettes. Supplies the shell, the top bar,
 *  and the bottom nav; the CONSUMER supplies the box via className (both width
 *  and height), because the two callers want different proportions.
 *
 *  The top bar deliberately shows a search icon, which the real CleanerTopBar /
 *  HomeownerTopBar do NOT have today ("No global search (operator-only)").
 *  That divergence is intentional and forward-looking, not a bug to fix back.
 *  See docs/superpowers/specs/2026-07-15-flow-showcase-chrome-design.md.
 */
export function PhoneFrame({
  initials,
  tabs,
  className,
  children,
}: {
  initials: string
  tabs: LucideIcon[]
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft-lg',
        className,
      )}
    >
      <div className="flex flex-none items-center gap-2 border-b border-border bg-card px-3 py-2.5" aria-hidden>
        <Search className="size-3.5 text-muted-foreground" />
        <span className="flex-1" />
        <Bell className="size-3.5 text-muted-foreground" />
        <Avatar className="size-4 text-[7px]">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </div>

      <div className="min-h-0 flex-1 bg-background px-3 py-2.5">{children}</div>

      <nav className="flex flex-none border-t border-border bg-card" aria-hidden>
        {tabs.map((Icon, i) => (
          <span key={i} className="relative flex flex-1 items-center justify-center py-2.5">
            {i === 0 ? (
              <span className="absolute left-1/2 top-0 h-0.5 w-4 -translate-x-1/2 rounded-pill bg-brand-600" />
            ) : null}
            <Icon className={cn('size-3.5', i === 0 ? 'text-brand-600' : 'text-muted-foreground')} />
          </span>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Step 2: Add the imports**

At the top of `frames.tsx`, after the existing `cn` import:

```tsx
import { Bell, Search, type LucideIcon } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -c "error"`
Expected: `12`. Both call sites are still passing the old props, so you WILL see errors naming `initials`/`tabs` on `PhoneFrame` at `FlowShowcase.tsx` and `LiveTrackingSection.tsx`. That is expected and Tasks 4 and 7 fix them. If the count is above 12 for any OTHER reason, stop and fix.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/frames.tsx
git commit -m "feat(marketing): PhoneFrame gains top bar and bottom nav

The consumer owns the box; the frame owns only the chrome.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Notes:
- The old `rounded-[30px]` is gone in favour of `rounded-card` (22px). The raw value was off-system; this is a conformance fix, not a regression.
- The speaker pill is gone. The top bar replaces it as the "this is a phone" cue at the top, and the bottom nav does the heavy lifting.

---

### Task 2: MiniRail gains an `app` variant

**Files:**
- Modify: `src/components/marketing/frames.tsx:47-59` (the `MiniRail` function)

**Interfaces:**
- Consumes: nothing.
- Produces: `MiniRail({ variant })` where `variant?: 'sketch' | 'app'`, **defaulting to `'sketch'`**.
  - `'sketch'` = today's exact markup, byte for byte. `CapabilityExplorer` relies on this and must not change.
  - `'app'` = real Nexxus X + real nav icons + brand-blue active tab. Task 4 uses this.

**Two things the spec establishes and this task depends on:**
1. Today's rail has the emphasis **backwards**: the solid `bg-brand-600` square sits at the top where the logo belongs, and the active tab is a pale tinted square. The strongest accent points at nothing.
2. The real rail logo is **not** a blue rounded square. `OperatorRail` renders `logo-black.svg`, whose glyph is `#0150fc` + `#68b6fa` on transparent. The blue square with a white X is `icon-blue-white.svg`, the favicon. Use the transparent two-tone X, which also stops it being confused with the solid blue active square below it.

- [ ] **Step 1: Replace `MiniRail`**

Replace lines 47-59 of `frames.tsx`:

```tsx
const RAIL_TABS: LucideIcon[] = [Home, CalendarDays, Users, CreditCard]

/** Slim rail echoing the real OperatorRail.
 *  'sketch' is the original abstract treatment, kept for CapabilityExplorer
 *  until its rail-vs-tab-bar question is settled (see the spec's follow-up).
 *  'app' mirrors OperatorRail: the real Nexxus mark, real nav icons, and the
 *  active tab filled brand-600, matching `active && "bg-brand-600 text-white"`.
 */
export function MiniRail({ variant = 'sketch' }: { variant?: 'sketch' | 'app' }) {
  if (variant === 'sketch') {
    return (
      <div className="hidden w-11 shrink-0 flex-col items-center gap-2.5 border-r border-border bg-card py-3.5 sm:flex" aria-hidden>
        <span className="mb-1.5 size-6 rounded-chip bg-brand-600" />
        <span className="size-6 rounded-chip bg-accent ring-1 ring-brand-200" />
        <span className="size-6 rounded-chip bg-muted" />
        <span className="size-6 rounded-chip bg-muted" />
        <span className="size-6 rounded-chip bg-muted" />
      </div>
    )
  }

  return (
    <div className="hidden w-11 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-card py-3 sm:flex" aria-hidden>
      {/* Show only the icon by clipping the wordmark off the full lockup, the
          same mechanism OperatorRail uses: a fixed-width overflow wrapper. NOT
          clip-path, which does not affect layout and would let the ~72px image
          blow out the 44px rail. */}
      <span className="mb-2 h-4 w-5 overflow-hidden">
        <Image src="/brand/logo-black.svg" alt="" width={567} height={126} className="h-4 w-auto max-w-none" />
      </span>
      {RAIL_TABS.map((Icon, i) => (
        <span
          key={i}
          className={cn('grid size-6 place-items-center rounded-chip', i === 0 && 'bg-brand-600')}
        >
          <Icon className={cn('size-3.5', i === 0 ? 'text-white' : 'text-muted-foreground')} />
        </span>
      ))}
      <span className="mt-auto grid size-6 place-items-center rounded-chip">
        <Settings className="size-3.5 text-muted-foreground" />
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Add the imports**

```tsx
import Image from 'next/image'
import { Bell, CalendarDays, CreditCard, Home, Search, Settings, Users, type LucideIcon } from 'lucide-react'
```

(Merge with the lucide import from Task 1 rather than adding a second one.)

- [ ] **Step 3: Verify the logo clip**

The arithmetic behind `h-4 w-5`: `logo-black.svg` is `viewBox="0 0 567.04 125.65"`, so at `h-4` (16px) the whole lockup renders about **72px** wide. Its icon occupies roughly the leftmost 147 viewBox units (**26%**, about 18.7px) and the wordmark starts at unit 192 (**34%**, about 24.5px). A **20px** (`w-5`) window therefore shows the complete icon and no wordmark, with a little slack either side.

Run the dev server and look at the CapabilityExplorer section (`http://localhost:3100/landing#try-it`). Its rail must be **unchanged** (blue square top, pale active, three grey). If it changed, the default is wrong.

Then temporarily render `<MiniRail variant="app" />` somewhere visible and confirm you see the two-tone blue X and NOT a blue square, a clipped wordmark letter, or an empty box. Remove the temporary render before committing.

If the clip is off, adjust the wrapper width rather than switching to `icon-blue-white.svg` — that asset is a blue square and is the wrong mark here.

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit 2>&1 | grep -c "error"` (12 plus the known PhoneFrame call-site errors from Task 1)

```bash
git add src/components/marketing/frames.tsx
git commit -m "feat(marketing): MiniRail gains an app variant with the real Nexxus mark

Default stays 'sketch' so CapabilityExplorer is untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: BrowserFrame gains an opt-in app bar

**Files:**
- Modify: `src/components/marketing/frames.tsx:4-27` (the `BrowserFrame` function)

**Interfaces:**
- Consumes: nothing.
- Produces: `BrowserFrame({ label, appBar, className, children })` where `appBar?: boolean` defaults to **`false`**.
  - `false` = today's markup exactly. `CapabilityExplorer` depends on it.
  - `true` = adds the operator app bar under the browser bar. Task 4 uses it.

The app bar mirrors `OperatorTopBar` at vignette scale: search field with a `⌘K` chip, primary New booking button, bell, avatar. The search placeholder is real copy and earns its space: it tells a visitor what the product manages, in the middle of the hero.

- [ ] **Step 1: Replace `BrowserFrame`**

```tsx
/** Browser-chrome wrapper for desktop app vignettes.
 *  `appBar` adds the operator top bar (search / New booking / bell / avatar)
 *  beneath the browser chrome, mirroring OperatorTopBar at sketch scale.
 *  Off by default: CapabilityExplorer wants browser chrome only.
 */
export function BrowserFrame({
  label,
  appBar = false,
  className,
  children,
}: {
  label: string
  appBar?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-card shadow-soft-lg', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2.5">
        <span className="size-2.5 rounded-pill bg-warm-300" aria-hidden />
        <span className="size-2.5 rounded-pill bg-warm-300" aria-hidden />
        <span className="size-2.5 rounded-pill bg-warm-300" aria-hidden />
        <span className="ml-2 min-w-0 truncate rounded-pill border border-border bg-card px-3.5 py-0.5 text-xs text-muted-foreground">
          {label}
        </span>
      </div>

      {appBar ? (
        <div className="flex items-center gap-2 border-b border-border bg-card px-2.5 py-2" aria-hidden>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-pill border border-border bg-background px-2.5 py-1">
            <Search className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-[9px] text-muted-foreground">Search bookings, customers, cleaners...</span>
            <span className="ml-auto shrink-0 rounded-chip bg-muted px-1.5 py-0.5 text-[8px] font-semibold leading-none text-muted-foreground">
              ⌘K
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-chip bg-brand-600 px-2 py-1 text-[9px] font-bold text-white">
            <Plus className="size-2.5" />
            New booking
          </span>
          <Bell className="size-3.5 shrink-0 text-muted-foreground" />
          <Avatar className="size-4 shrink-0 text-[7px]">
            <AvatarFallback>DA</AvatarFallback>
          </Avatar>
        </div>
      ) : null}

      {children}
    </div>
  )
}
```

- [ ] **Step 2: Add `Plus` to the lucide import**

```tsx
import { Bell, CalendarDays, CreditCard, Home, Plus, Search, Settings, Users, type LucideIcon } from 'lucide-react'
```

- [ ] **Step 3: Verify CapabilityExplorer is untouched**

Open `http://localhost:3100/landing#try-it`. That section must look **exactly** as before: browser chrome, its long label, no app bar. If an app bar appeared, the default is wrong.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/frames.tsx
git commit -m "feat(marketing): BrowserFrame gains an opt-in operator app bar

Off by default so CapabilityExplorer is untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: FlowShowcase geometry, labels, and wiring

**Files:**
- Modify: `src/components/marketing/FlowShowcase.tsx:37-49` (constants), `:280-296` and `:524-540` (the two surfaces' role badges), `:777-819` (the stage render)

**Interfaces:**
- Consumes: `PhoneFrame({ initials, tabs, className, children })` (Task 1), `MiniRail({ variant })` (Task 2), `BrowserFrame({ label, appBar, ... })` (Task 3).
- Produces: the new `HOME` / `DASH` / `CLEAN` constants with `h` fields, which Task 6 measures against.

- [ ] **Step 1: Replace the geometry constants**

`FlowShowcase.tsx` lines 40-42 become:

```tsx
// Three frames on a shared top edge at y=30, with the label band above them in
// y 0..24. The old composition staggered them (dash y=12, phones y=56); that is
// dropped, because a shared label baseline over staggered frames leaves an
// uneven label-to-frame gap. With the app bar the dashboard lands near 380 tall
// anyway, the same as the phones, so the three align. The dashboard still
// dominates at 460 wide against 220.
const HOME = { x: 0, y: 30, w: 220, h: 380 }
const DASH = { x: 300, y: 30, w: 460 }
const CLEAN = { x: 840, y: 30, w: 220, h: 380 }
```

Widths total 900; the two 80px gaps fill the remaining 160.

- [ ] **Step 2: Add the label component and the role data**

Add above `function focusFor`:

```tsx
const ROLES = [
  { key: 'home', name: 'Sarah', role: 'Customer', x: HOME.x, w: HOME.w },
  { key: 'dash', name: 'Dana', role: 'The office', x: DASH.x, w: DASH.w },
  { key: 'clean', name: 'Maria', role: 'Cleaner', x: CLEAN.x, w: CLEAN.w },
] as const

/** Role labels on a shared baseline above the frames. These are the page's
 *  voice, not product chrome: the frames themselves stay honest screenshots.
 *  "Customer" not "Homeowner" on purpose, see the spec: the operator nav says
 *  "Customers", the hero sells past homes, and demo-data has a rental. */
function StageLabels() {
  return (
    <>
      {ROLES.map((r) => (
        <p
          key={r.key}
          className="absolute top-0 text-center text-xs font-semibold text-muted-foreground"
          style={{ left: r.x, width: r.w }}
        >
          <span className="font-extrabold text-foreground">{r.name}</span> · {r.role}
        </p>
      ))}
    </>
  )
}
```

- [ ] **Step 3: Delete the in-frame role badges**

Delete **line 289** in `HomeownerSurface`:

```tsx
<Badge variant="secondary" className="justify-self-start px-2 py-0.5 text-[10px]">Sarah · customer</Badge>
```

and **line 534** in `CleanerSurface`:

```tsx
<Badge variant="secondary" className="justify-self-start px-2 py-0.5 text-[10px]">Maria · cleaner</Badge>
```

Keep the `Badge` import: it has 8 uses in this file and 6 survive.

Both surfaces open with `<div className="grid min-h-[290px] grid-cols-1 content-start gap-2 text-left">` (lines 288 and 533). Drop the `min-h-[290px]`: the frame fixes the height now and PhoneFrame's body is `flex-1`, so a min-height here only risks overflowing the shorter content box (~296px usable).

- [ ] **Step 4: Rewire the stage render**

Lines 792-806 become:

```tsx
<StageLabels />
<div className="absolute z-10" style={{ left: HOME.x, top: HOME.y, width: HOME.w, height: HOME.h }}>
  <PhoneFrame initials="SK" tabs={HOMEOWNER_TABS} className="h-full w-full">
    <HomeownerSurface cue={cue} />
  </PhoneFrame>
</div>
<div className="absolute z-10" style={{ left: DASH.x, top: DASH.y, width: DASH.w }}>
  <BrowserFrame label="app.nexxus.com" appBar>
    <OperatorSurface cue={cue} />
  </BrowserFrame>
</div>
<div className="absolute z-10" style={{ left: CLEAN.x, top: CLEAN.y, width: CLEAN.w, height: CLEAN.h }}>
  <PhoneFrame initials="MR" tabs={CLEANER_TABS} className="h-full w-full">
    <CleanerSurface cue={cue} />
  </PhoneFrame>
</div>
```

The label read `app.nexxus · demo data`, which is why it was mistaken for a search bar: it sits in the URL slot, so it must look like a URL.

- [ ] **Step 5: Add the nav imports**

Import the REAL nav arrays so the vignettes track the app. **The two phones do not have the same tab count**: homeowner is 4, cleaner is 5.

```tsx
import { HOMEOWNER_NAV } from '@/components/redesign/homeowner/shell/homeowner-nav-items'
import { CLEANER_NAV } from '@/components/redesign/cleaner/shell/cleaner-nav-items'

const HOMEOWNER_TABS = HOMEOWNER_NAV.map((i) => i.icon)  // 4: Home, Cleanings, Messages, Account
const CLEANER_TABS = CLEANER_NAV.map((i) => i.icon)      // 5: Today, Schedule, Earnings, Messages, Profile
```

- [ ] **Step 6: Set the rail to the app variant**

In `OperatorSurface` (line ~393), `<MiniRail />` becomes `<MiniRail variant="app" />`.

- [ ] **Step 7: Look at it**

Open `http://localhost:3100/landing` at a 1440px-wide viewport.

Expected: three labels on one line across the top; three frames with tops aligned; phones clearly phones. **The flight paths will be visibly wrong at this point** — the card will fly from and to the wrong places. That is Task 6. Do not fix it here.

Check specifically:
- Labels do not overlap their frames and are centred over them.
- The dashboard's bottom lands near y=410, inside the 420 stage. If it overflows, note the actual height for Task 5.
- Phone content is not clipped or overflowing (it will be tight; Task 5 re-fits it).

- [ ] **Step 8: Commit**

```bash
git add src/components/marketing/FlowShowcase.tsx
git commit -m "feat(marketing): re-lay the flow stage and lift role labels out of the frames

220x380 phones on a shared top edge, labels on a shared baseline above,
real nav tabs per role (homeowner 4, cleaner 5), app bar + app rail on the
dashboard. Paths are still the old constants and land wrong; next commit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Re-fit the cards

**Files:**
- Modify: `src/components/marketing/FlowShowcase.tsx:245-255` (`ApptCard`), plus whatever the visual check turns up in `HomeownerSurface` / `CleanerSurface` / `OperatorSurface`

**Interfaces:**
- Consumes: the geometry from Task 4.
- Produces: a stable `ApptCard` size and no wrapped lines, which Task 6 measures against. **Task 6 depends on this being finished** — a wrapped line changes a card's height, which moves the anchor the paths get measured from.

**The specific trap:** `ApptCard` is hardcoded `w-[190px]`. It is a **stage overlay** — absolutely positioned on the flight path, floating above the phone rather than nested inside it — so the phone's padding does not constrain it. Its width against the **frame** is what reads. Today that is 190 on 252, about **75%**, leaving 31px of margin each side. At a 220 frame, 190 leaves **15px each side**: the margin halves and the card reads cramped against the edges. Preserve the ratio, not the pixels.

- [ ] **Step 1: Shrink `ApptCard` and shorten its subtitle**

Lines 245-255 become:

```tsx
function ApptCard() {
  return (
    // This card is a stage overlay, not a child of the phone, so what reads is
    // its width against the frame: 166 keeps it at ~75% of the 220px phone, the
    // ratio it had at 252. The subtitle drops "Sarah K." because at 9px the full
    // string is ~163px and would wrap inside a 166px card, changing its height
    // mid-flight. The name is not lost: the queue row it lands on reads
    // "Thu · 9:00 AM · Sarah K.", and the label above the phone says
    // "Sarah · Customer".
    <div className="w-[166px] rounded-control border border-border bg-card px-3 py-2 shadow-soft-lg">
      <p className="flex items-center justify-between text-[11px] font-bold text-foreground">
        <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent-foreground" aria-hidden />Deep clean</span>
        <span className="tnum">$180</span>
      </p>
      <p className="mt-0.5 text-[9px] text-muted-foreground">Thu · 9:00 AM · 8 Cedar Ct</p>
    </div>
  )
}
```

- [ ] **Step 2: Hunt for wrapped lines**

Reload `http://localhost:3100/landing` and watch a full loop (~24s). The phone body inner width dropped from 224 to ~196, a 14% cut, which is enough to wrap a line anywhere.

Check each, and fix any that wrap by shortening copy (not by shrinking font below the existing scale):
- **Homeowner form rows**: `Deep clean`/`$180`, `Thu · 9:00 AM`/`1st pick`, `Visa ·· 4242`/`at completion`. Widest pair is roughly 130 of ~172 usable, so these should hold.
- **Cleaner job rows**: `8:00` / `Chen home` / `Done`. Tighter than the homeowner's; most likely to break.
- **The `GlideAlong` B pill** (`Thu 9:00 · Sarah K.` + MR avatar, ~136px auto): must still clear the 220 phone with margin.
- **`ApptCard`**: subtitle must be one line.

- [ ] **Step 3: Confirm the dashboard fits**

The app bar added ~34px to a surface that measured 346 tall, so it should land near 380 and end at y=410, inside the 420 stage. Verify nothing overflows or clips. If it does, trim `OperatorSurface`'s vertical padding rather than shrinking the app bar.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/FlowShowcase.tsx
git commit -m "fix(marketing): re-fit the cards for the 220px phone

ApptCard 190->166 to keep its ~75% ratio; subtitle drops the customer name
so it stays one line (the queue row it lands on still names her).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Re-cut the flight paths

**Files:**
- Modify: `src/components/marketing/FlowShowcase.tsx:45-46` (`PATH_A`, `PATH_B`), plus two new `id` attributes

**Interfaces:**
- Consumes: the finished geometry (Task 4) and card sizes (Task 5). **Do not start until both are done and committed.**
- Produces: nothing downstream.

**Measure, do not guess.** An earlier draft of the spec guessed `M 110 350` for the new start, reasoning the card sits near the phone's bottom. Measured, the real start (126, 252) is **58% down** a phone spanning y 56..396, so the guess was ~100px off and would launch the card from empty space. This task exists because guessed numbers are how this drifts.

**Why not derive them at runtime?** The file has `stageCenter(id, el)`, and the cursor already uses it against `id="flow-queue-row"`. Paths cannot: `flow-queue-row` only mounts at `cue >= drop`, but the card starts flying at `lift`, one cue earlier. The destination does not exist when the flight begins. So the constants stay constants — measured ones.

- [ ] **Step 1: Add ids to the two anchors that lack them**

`flow-queue-row` already exists at line ~440. Add:
- `id="flow-request-card"` to the collapsing request card in `HomeownerSurface` (the element the travelling card should launch from).
- `id="flow-job-row"` to Maria's job row in `CleanerSurface` (the element it should land on).

- [ ] **Step 2: Measure all three anchors**

With the dev server up and the page open, run this in the browser console. Each anchor only exists at certain cues, so it polls across a full loop and keeps the first hit for each:

```js
const found = {};
const stage = document.querySelector('#flow-showcase .absolute.left-0.top-0');
const sr = stage.getBoundingClientRect();
const sc = sr.width / 1060;                    // stage is uniformly scaled
const grab = (id) => {
  const el = document.getElementById(id);
  if (!el || found[id]) return;
  const r = el.getBoundingClientRect();
  found[id] = { x: Math.round((r.left + r.width/2 - sr.left)/sc),
                y: Math.round((r.top + r.height/2 - sr.top)/sc) };
};
const t = setInterval(() => {
  ['flow-request-card','flow-queue-row','flow-job-row'].forEach(grab);
  if (Object.keys(found).length === 3) { clearInterval(t); console.log(JSON.stringify(found, null, 2)); }
}, 100);
setTimeout(() => { clearInterval(t); console.log('TIMEOUT', JSON.stringify(found, null, 2)); }, 30000);
```

Let it run a full ~24s loop. If it reports TIMEOUT with a missing anchor, the id is on a conditionally-rendered element that never mounted; put it on the stable container instead.

- [ ] **Step 3: Write the paths**

`PATH_A` runs `flow-request-card` to `flow-queue-row`; `PATH_B` runs `flow-queue-row` to `flow-job-row`.

Keep the arc. The old paths lift the card well above the straight line between endpoints, which is what makes it read as flight rather than a slide. Old, for reference:

```
PATH_A = 'M 126 252 C 240 165, 400 148, 556 212'   // start y 252, controls at 165/148: ~90px of lift
PATH_B = 'M 556 212 C 700 148, 830 162, 936 246'
```

So: set `M` to the request card's centre and the final pair to the queue row's centre, then place the two control points at roughly **80-90px above** the line between them, at about one third and two thirds across. Same for `PATH_B` with the job row.

- [ ] **Step 4: Watch the whole loop**

Reload and watch all ~24 seconds, twice.

- The card must launch **from** the request card, not from empty space near it.
- It must land **on** the queue row, not above or short of it.
- The B pill must land **on** Maria's job row.
- The arc must still lift; a flat slide means the control points are wrong.
- Check `focusFor()`'s camera pan at a ~600px-wide viewport: each beat should frame the surface it is about. `focusFor` derives from the constants and needs no edit, but confirm it.

- [ ] **Step 5: Commit**

```bash
git add src/components/marketing/FlowShowcase.tsx
git commit -m "fix(marketing): re-cut the flight paths against measured anchors

Endpoints measured from flow-request-card / flow-queue-row / flow-job-row
rather than derived on paper. Paths stay constants because flow-queue-row
mounts one cue after the flight starts, so it can't be measured live.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: LiveTrackingSection

**Files:**
- Modify: `src/components/marketing/LiveTrackingSection.tsx:78-135` (the `PhoneFrame` call and the role badge at line 80)

**Interfaces:**
- Consumes: `PhoneFrame({ initials, tabs, className, children })` (Task 1).

- [ ] **Step 1: Remove the badge, add the label above**

Delete the `Sarah · customer` `Badge` at line ~80. Above the `PhoneFrame`, add the same label treatment as the hero:

```tsx
<p className="mb-2 text-center text-xs font-semibold text-muted-foreground">
  <span className="font-extrabold text-foreground">Sarah</span> · Customer
</p>
```

One rule across the page: frames are product, labels are the page's voice.

- [ ] **Step 2: Give the frame a box**

```tsx
<PhoneFrame initials="SK" tabs={HOMEOWNER_TABS} className="h-[420px] w-72">
```

with, at the top of the file:

```tsx
import { HOMEOWNER_NAV } from '@/components/redesign/homeowner/shell/homeowner-nav-items'

const HOMEOWNER_TABS = HOMEOWNER_NAV.map((i) => i.icon)
```

- [ ] **Step 3: Judge the box with the page on screen**

**This is a judgement call, not a number to copy.** The constraint is the proportion: land near **1:1.7**, the hero's ratio.

- `w-72` is 288px. True 1:1.7 there is ~490 tall, which will likely strand its brand-gradient hero card in dead space.
- Narrowing toward the hero's 220 shortens it proportionally but squeezes a card sized for 288.
- `h-[420px]` at `w-72` is 1:1.46 — a starting point, not an answer.

Open `http://localhost:3100/landing`, look at the section, and pick whichever trade looks right. **Do not narrow it to 220 just to match the hero's number** — the hero's exact pixels are not the target, the proportion is.

- [ ] **Step 4: Commit**

```bash
git add src/components/marketing/LiveTrackingSection.tsx
git commit -m "feat(marketing): live tracking phone picks up the real mobile chrome

Role pill out of the frame, label above it, matching the hero.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Conformance and full verification

**Files:** none expected. Fixes only.

- [ ] **Step 1: Design-system conformance**

Run the `ui-ux-pro-max` skill against the three changed files. It flags exactly the class of leak this work is exposed to: raw hex copied from a mockup, off-system shadows, off-scale radii.

Then grep for leaks by hand:

```bash
grep -nE "#[0-9A-Fa-f]{6}" src/components/marketing/frames.tsx src/components/marketing/FlowShowcase.tsx src/components/marketing/LiveTrackingSection.tsx
```

Expected: **no hits.** The companion mockups are full of inline hex; none of it belongs here. `logo-black.svg` carries its own colours and is referenced by path, not by hex.

```bash
grep -nE "—" src/components/marketing/frames.tsx src/components/marketing/FlowShowcase.tsx src/components/marketing/LiveTrackingSection.tsx
```

Expected: no hits in user-facing copy.

- [ ] **Step 2: The gates**

```bash
npx tsc --noEmit 2>&1 | grep -c "error"   # expect exactly 12, the pre-existing baseline
npm run lint                               # expect clean for changed files
npm run test                               # expect green
```

- [ ] **Step 3: The actual deliverable**

At 1440px, with someone who has not seen this work: **do the left and right surfaces read as phones?** That was the whole point. If they do not, the chrome is not the problem, the proportions are, and 200x400 is the next move (see the spec's rejected options).

Then:
- Full ~24s loop: card launches from and lands on the right elements.
- Narrow viewport (~600px): camera pans, nothing clips, labels stay put.
- `prefers-reduced-motion`: the static state still composes and the labels still align. Emulate it in DevTools rendering settings.
- CapabilityExplorer (`#try-it`): **unchanged**. Same rail, same browser chrome, no app bar. If it moved, a default leaked.
- Live tracking section reads well at its new proportions.

- [ ] **Step 4: Screenshots for Bridger**

He is on desktop, so send the link plus screenshots of the built result (not the mockups): the hero at rest, mid-flight, and the live tracking section.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A src/components/marketing
git commit -m "chore(marketing): conformance pass on the flow showcase chrome

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Known debt this leaves

`CapabilityExplorer` keeps `variant='sketch'`, so the page carries two rail treatments until its rail-vs-tab-bar question is settled. This is a knowing trade recorded in the spec, not an oversight. **Follow-up:** resolve that section's nav, migrate it off `'sketch'`, and delete the variant from `MiniRail`.
