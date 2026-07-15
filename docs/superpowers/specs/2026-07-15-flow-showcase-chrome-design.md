# Landing hero: make the phones read as phones (FlowShowcase chrome)

Date: 2026-07-15
Status: approved design, ready for a plan
Touches: `src/components/marketing/frames.tsx`, `FlowShowcase.tsx`, `LiveTrackingSection.tsx`

## The problem

Shown to real people, the hero animation's left and right surfaces are not recognised as
phones. The middle one is read as a desktop instantly, because its browser chrome is
unmistakable.

The cause is not missing chrome, it is **proportion and emptiness**. Each phone is 252px
wide and roughly 340px tall (about 1:1.35), and most of that area is blank, so it reads as
a rounded content card that happens to have a speaker pill on top. The desktop's content
fills its frame and its chrome names it.

A second, quieter problem surfaced during design: the surfaces run **three fidelity levels
at once**. Content is real text everywhere ("Good morning, Dana", "$12,477"), the app bar
did not exist, and the rail is abstract squares. Mixed fidelity reads as unfinished without
anyone being able to say why.

## UI implementation and styling source

The browser-companion mockups behind this spec (`.superpowers/brainstorm/78863-1784097613/`)
are **UX and structure reference ONLY**. Every screen is implemented from the design system:
the primitives in `src/components/ui/*` and the tokens in `tailwind.config.js` +
`src/app/globals.css` (brand `#0150FC`, Plus Jakarta Sans, warm canvas, soft shadows, the
rounded scale). Do not copy ad-hoc colours, raw hex, or bespoke classes out of a mockup.
The mockups use inline hex purely because they are throwaway HTML; the real build uses
tokens (`bg-brand-600`, `border-border`, `bg-card`, `text-muted-foreground`, `rounded-card`,
`rounded-control`, `rounded-pill`). If a needed pattern has no primitive, build a reusable
one rather than a one-off. No em dashes in any user-facing copy.

## Governing principle

> One fidelity level. The content was always real text, so the chrome meets it there.
> Frames are product; labels above them are the page's voice.

This is the rule that resolves every open question below. It was arrived at the hard way:
the first proposal kept an abstract rail next to a verbatim app bar, which Bridger correctly
identified as incoherent.

## Decisions

### 1. Phone proportions: 220 x 380

From 252 x ~340 (1:1.35) to **220 x 380** (about 1:1.7). Fixed height, not content-height.

Considered and rejected: 200 x 400 (a true 1:2 phone; strongest read but a bigger geometry
change), and a dark hardware bezel (unmistakable, but drops a heavy dark object onto a warm
light page and out-shouts the desktop, which reads as a desktop using only a thin bar).

### 2. Phone top bar: search + bell + avatar

Left-aligned search icon, spacer, notification bell, avatar. **No greeting text.**

> **Deliberate divergence from the shipped app. Do not "fix" this.**
> `CleanerTopBar` and `HomeownerTopBar` today render *greeting + bell + avatar* and carry
> the comment "No global search (operator-only)". Mobile search does not exist yet. Bridger
> is showing it because he intends to build it for cleaners and homeowners. A future reader
> comparing the vignette to the app will find a mismatch; that mismatch is intentional.
> Revisit only if mobile search is dropped from the roadmap.

### 3. Phone bottom nav: 5 tabs, real icons

Five tabs, real lucide icons, no labels. Active tab: `text-brand-600` plus the 2px
brand-600 top indicator, mirroring `CleanerBottomNav`. Which tab is active is not
meaningful; do not imply a specific one.

This is the element that does most of the work. It is the strongest "phone" signal and it
fills the dead space that made the frames read as cards.

### 4. The in-frame role pills come out

Delete the `Sarah · customer` / `Maria · cleaner` badges from inside `HomeownerSurface`,
`CleanerSurface`, and `LiveTrackingSection`. They are landing-page props sitting inside
what should be honest product screenshots.

### 5. Labels above all three surfaces

Bold name, muted role, centred over each surface, on a **shared baseline** across the top
of the stage, so they read as a set rather than three stickers.

The three surfaces share a top edge at y=30 (see Geometry). The old composition staggered
them (desktop at y=12, phones at y=56); that stagger is dropped, because a shared label
baseline over staggered frames puts a variable gap between each label and its frame, which
looks like a mistake.

Measured, the desktop is currently 346 tall. The new app bar adds about 34, taking it to
roughly 380, which is the same height as the new phones. So the three frames land as a tidy
aligned row: tops at y=30, bottoms near y=410. That is the intended result, not an accident.
The desktop still dominates by being 460 wide against 220, which is the only dominance it
needs. Do not force the desktop to an exact height to chase this; it stays content-height
and lands where it lands.

- `**Sarah** · Customer`
- `**Dana** · The office`
- `**Maria** · Cleaner`

Muted 12px, `font-semibold`, name in `text-foreground font-extrabold`, role in
`text-muted-foreground`. Not a chip, not bordered, no shadow: a bordered chip above a
bordered frame doubles the surface count on a page selling calm.

**Customer, not homeowner.** Decided against Bridger's initial instinct, on evidence:
- `nav-items.ts:42` labels that nav item **"Customers"**, and that rail is visible in this
  very animation.
- The hero sells past homes: "Cleaning companies, commercial crews, property turnovers."
- The marketing copy already says customer throughout ("Your customer sees the crew arrive",
  "Customer gets updates automatically", "Text it to the customer").
- `demo-data.ts` includes `'Harbor View rental'` as a customer. A rental is not a homeowner.
- `homeowner` is the internal `UserRole` enum value, not the user-facing word.

### 6. Desktop: browser chrome stays, app bar is added below it

The browser bar already exists; the app bar is the new element and costs about 34px of
height, which the stage absorbs.

**Browser bar** (unchanged in kind): three dots plus a URL pill now reading
**`app.nexxus.com`**. It previously read "app.nexxus · demo data", which is why it was
misread as a search bar; it sits in the URL position, so it should look like a URL.

**App bar** (new), mirroring `OperatorTopBar` at the vignette's scale:
- search field, placeholder "Search bookings, customers, cleaners...", with a `⌘K` chip
- primary `New booking` button with a `Plus` icon (`bg-brand-600`)
- notification bell
- avatar (`DA`)

Rejected: merging the two bars (no real browser looks like that, and it weakens the desktop
signal that already works), and replacing the browser chrome with the app bar (loses the
strongest desktop cue).

The search placeholder earns its space: it tells a visitor what the product manages in five
words, in the middle of the hero.

### 7. The rail: real X logo, real nav icons, brand-blue active tab

Today's `MiniRail` has the emphasis **backwards**: a solid `bg-brand-600` square sits at the
top where the logo belongs, and the active tab is a pale tinted square. The single strongest
blue accent on the surface currently points at nothing.

- **Logo**: the real Nexxus X. `OperatorRail` renders `logo-black.svg`, whose glyph fills are
  `#0150fc` and `#68b6fa` on a transparent background, clipped to show the icon. It is **not**
  a blue rounded square. The blue square with a white X is `icon-blue-white.svg`, a different
  asset used for favicons. Use the two-tone X, transparent, no container. This also keeps it
  from being confused with the solid blue active square below it.
- **Nav**: real lucide icons from `nav-items.ts` (Overview, Bookings, Customers, Payments),
  Settings pinned to the bottom, matching the real rail's `mt-auto`.
- **Active**: `bg-brand-600` with a white icon, exactly `OperatorRail`'s
  `active && "bg-brand-600 text-white"`.

## Geometry

Stage stays **1060 x 420**. Labels occupy the top band; surfaces begin below them.

| Const | From | To |
|---|---|---|
| `HOME` | `{x: 0, y: 56, w: 252}` | `{x: 0, y: 30, w: 220, h: 380}` |
| `DASH` | `{x: 306, y: 12, w: 460}` | `{x: 300, y: 30, w: 460}` |
| `CLEAN` | `{x: 812, y: 56, w: 248}` | `{x: 840, y: 30, w: 220, h: 380}` |

`HOME` and `CLEAN` gain an `h` field they do not have today; the phone wrappers in the stage
pass it through as an explicit height, which is how PhoneFrame gets a fixed box without
hardcoding one. `DASH` stays content-height.

Widths total 900; the two 80px gaps fill the remaining 160px. Label baseline sits in
y 0..24; surfaces start at y=30; phones end at y=410, leaving a 10px bottom margin.

**The flight paths must be re-cut.** `PATH_A` and `PATH_B` are hardcoded Bézier strings whose
endpoints were derived from the old card centres:

```
PATH_A = 'M 126 252 C 240 165, 400 148, 556 212'
PATH_B = 'M 556 212 C 700 148, 830 162, 936 246'
```

**This spec deliberately does not give replacement numbers.** An earlier draft guessed
`M 110 350` for the new start, reasoning that the card sits near the bottom of the phone.
Measured, the real start (126, 252) sits **58% down** a phone spanning y 56..396, so the
guess was about 100px too low and would have launched the card from empty space below it.
Guessed path numbers are how this drifts. Measure them.

**Why they stay hardcoded rather than derived.** The file already has `stageCenter(id, el)`,
which measures an element's centre in stage coordinates, and the cursor uses it against
`id="flow-queue-row"`. Paths cannot use the same trick: `flow-queue-row` only mounts once
`cue >= drop`, but the card starts flying at `lift`, one cue **earlier**. The destination
does not exist when the flight begins. So the constants stay constants; they just have to be
measured constants.

**The recipe** (run after the geometry change lands, with the dev server up):

1. Give stable ids to the two anchors that lack them: the homeowner request card and Maria's
   job row. `flow-queue-row` already exists.
2. Let the loop reach a cue where the anchor is mounted, then read its centre in stage space:

```js
// in the browser, against #flow-showcase
const stage = document.querySelector('#flow-showcase .absolute.left-0.top-0');
const sr = stage.getBoundingClientRect();
const sc = sr.width / 1060;                       // stage is uniformly scaled
const centre = (id) => {
  const r = document.getElementById(id).getBoundingClientRect();
  return { x: Math.round((r.left + r.width/2 - sr.left)/sc),
           y: Math.round((r.top + r.height/2 - sr.top)/sc) };
};
```

3. Set `PATH_A`'s start to the request card's centre and its end to the queue row's centre;
   `PATH_B` runs queue row to job row. Keep the control points at roughly the same relative
   arc height as today, so the flight keeps its lift.
4. Watch the full ~24s loop. The card must land **on** the queue row and **on** the job row,
   not near them.

`focusFor()` derives from `HOME`/`DASH`/`CLEAN` and needs no edit, but the camera pan should
be re-checked at narrow widths once the constants change.

`HomeownerSurface`'s `min-h-[290px]` and the equivalent on the other surfaces should become
consistent with the fixed 380px frame minus top bar (44) minus bottom nav (~40), leaving
about 296px of content.

## The cards inside the frames

Narrowing the phones by 32px is not just a frame change. Everything inside them, and the
card that flies between them, has to be re-fitted. This is the part most likely to look
broken if it is skipped.

### The travelling card (`ApptCard`) must shrink

`ApptCard` is hardcoded **`w-[190px]`**. Today it overlays a 252px phone whose body padding
is `px-3.5`, so it spans 190 of 224 usable px, about **75%**: a card resting on a phone.

At 220px wide the usable width becomes 192. **A 190px card would leave 2px of slack**, touch
both edges, and stop reading as a card.

Preserve the ratio instead of the pixels: 220 x 0.75 ≈ **`w-[166px]`**.

### That forces a copy change

`ApptCard`'s subtitle reads `Thu · 9:00 AM · Sarah K. · 8 Cedar Ct`. At `text-[9px]` that is
roughly 163px of text; inside a 166px card with `px-3` it has about 142px, so **it will wrap
to two lines** and change the card's height mid-flight.

Shorten it to **`Thu · 9:00 AM · 8 Cedar Ct`** (about 114px, fits). Dropping the name costs
nothing here, and this is checked rather than assumed:

- the queue row it lands on already reads `Thu · 9:00 AM · Sarah K.` (line 448), so the
  operator still sees whose booking it is, and
- the new label above the phone reads `Sarah · Customer`.

The title row (`Deep clean` / `$180` at `text-[11px]`) fits at 142px.

### Everything else to re-fit, in priority order

| What | Now | After | Risk |
|---|---|---|---|
| `ApptCard` | `w-[190px]` | `w-[166px]` + shorter subtitle | **High.** Certain to break. |
| Phone body inner width | 224 | 192 (-14%) | Every row inside both phones reflows. |
| `GlideAlong` B pill | auto (~136px): avatar + `Thu 9:00 · Sarah K.` | unchanged | Low, should still clear 220. Verify. |
| `HomeownerSurface` rows | `Visa ·· 4242` / `at completion` etc. | reflow at 192 | Low. Widest pair is ~130 of 172. Verify. |
| `CleanerSurface` job rows | `8:00 · Chen home · Done` | reflow at 192 | Medium. Tighter than the homeowner's. |
| `min-h-[290px]` | 290 | content box is now 296 (380 − 44 top bar − 40 bottom nav) | Low. |
| `OperatorSurface` | 346 tall | +34 app bar → ~380, ending at y=410 | **Medium.** Sits exactly on the stage's bottom margin. Confirm nothing overflows 420. |

None of the "verify" rows should be taken on trust. Narrowing by 14% is enough to wrap a
line, and a wrapped line changes a card's height, which moves what the paths were measured
against.

## Component changes

`frames.tsx` is shared. Three consumers, and they must not all change.

**`PhoneFrame`** — gains the top bar and the bottom nav, and needs an `initials` prop
(`SK` / `MR`) for the avatar. Both consumers take the new treatment; both are phone
vignettes with the same problem.

It must **not** hardcode 220 x 380. It keeps taking its box from the consumer's `className`
(as it does today) and supplies only the shell, the chrome, and a flex body between them.
Hardcoding the size, or baking in an aspect ratio, would force LiveTracking's 288px phone to
about 497px tall and strand its gradient card in dead space. The 220 x 380 figure is
FlowShowcase's choice, not the primitive's. Both consumers should land near 1:1.7; the
proportion is the point, the exact pixels are not.

**`BrowserFrame`** — gains an opt-in app bar (e.g. `appBar?: boolean`, default **false**).
FlowShowcase opts in. CapabilityExplorer does not, and keeps its current label.

**`MiniRail`** — gains a variant (e.g. `variant?: 'sketch' | 'app'`, default **`'sketch'`**).
FlowShowcase uses `'app'`. CapabilityExplorer stays on `'sketch'`.

**`LiveTrackingSection`** — pill out, label above (`**Sarah** · Customer`), new PhoneFrame
chrome. It sets its own box, and the right box is a judgement call to make **with the section
on screen**, not from this document:

- The constraint is the proportion: land near **1:1.7**, the same as the hero.
- Its content is a brand-gradient hero card currently sized for 288px wide. At 288 wide,
  1:1.7 means about 490 tall, which is likely to strand the card in dead space. Narrowing
  toward the hero's 220 shortens it proportionally but squeezes the card.
- Pick whichever of those trades looks right, then verify. Do not narrow it to 220 blind
  just to match the hero number; the hero's exact pixels are not the target, the proportion is.

## Out of scope, and the debt this leaves

**`CapabilityExplorer` keeps its abstract rail**, so the page will carry two rail treatments
until that is resolved. This is a knowing trade, not an oversight.

It has the same abstract-rail-next-to-real-chrome inconsistency as the hero, but worse: its
rail sits beside a fully real tab bar with icons *and* labels (Overview, Analytics, Crew,
Payments, Messages). Giving its rail real nav icons would make it list Overview/Bookings/
Customers/Payments next to a tab bar listing something else: two conflicting navs, worse than
today. Fixing it properly means deciding whether that section's nav is the rail or the tab
bar, which is its own design conversation.

**Follow-up ticket:** resolve CapabilityExplorer's rail vs tab bar, then migrate it off
`variant='sketch'` and delete the variant.

## Verification

- All three surfaces at desktop width: phones read as phones without reading the labels.
- The travelling booking card lands **on** the queue row and **on** Maria's job row, not near
  them. Watch the full ~24s loop.
- Camera pan at narrow viewports still frames the focused surface.
- `prefers-reduced-motion`: static state still composes, labels still align.
- Live tracking section still reads well at the new phone proportions.
- Design-system conformance: no raw hex, no bespoke classes, primitives reused. Run
  `ui-ux-pro-max` at implementation, which flags exactly this class of leak.
- Gates: `npx tsc --noEmit` (12 pre-existing errors is the baseline), `npm run lint`,
  `npm run test`.

## Decision log

Corrections made during design, recorded so they are not re-litigated:

1. "Both search and greeting won't fit at 220px" — **wrong**, the mockup showed it fits. The
   argument for dropping one was meaning, not space.
2. "Real nav icons will be mush at 14px" — **wrong**, they render cleanly.
3. "Abstract squares are the safer default for the rail" — **wrong**, and the inverse of the
   truth. Applied honestly to the whole stage, abstract makes the phone's bottom nav read as
   an unloaded skeleton, and the bottom nav is the entire reason the phone reads as a phone.
4. The rail logo is a blue rounded square — **wrong**, that is the favicon asset. The rail
   renders the two-tone X on transparent.
5. `PATH_A` should start near the phone's bottom (`M 110 350`) — **wrong**, off by about
   100px. Measured, the card launches from 58% down the phone. Hence the measure-don't-guess
   recipe in Geometry.
6. `PhoneFrame` should own the 220 x 380 box — **wrong**, it would drag LiveTracking's 288px
   phone to ~490 tall. The consumer owns the box.
7. The frames keep a stagger under a shared label baseline — **wrong** twice over: it makes
   the label-to-frame gap uneven, and once the app bar lands the desktop is ~380 anyway, the
   same as the phones. They align.
