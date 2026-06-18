# Task 15 Report: Calendar + DatePicker Primitives + Gallery

## react-day-picker version
**v10.0.1** (installed by shadcn CLI, `npm ls react-day-picker` confirmed)

## CLI vs hand-authored
Both components scaffolded via CLI (one at a time as required):
1. `npx shadcn@latest add popover --yes --overwrite` -- created `popover.tsx`
2. `npx shadcn@latest add calendar --yes --overwrite` -- created `calendar.tsx`

CLI also overwrote `button.tsx` (stock shadcn). Reverted immediately with `git checkout -- src/components/ui/button.tsx`.

Config drift check: `git diff tailwind.config.js src/app/globals.css components.json` -- empty (clean).

## v10 API notes
react-day-picker v10 uses:
- `DayButton`, `DayPicker`, `getDefaultClassNames` exports (not v8/v9 API)
- `autoFocus` prop (not `initialFocus`)
- ClassNames keyed by `UI | SelectionState | DayFlag | Animation` enum values
- The CLI incorrectly scaffolded `table` as a classNames key; v10 uses `month_grid` instead (fixed)

## classNames keys used (v10)
`root`, `months`, `month`, `nav`, `button_previous`, `button_next`, `month_caption`, `dropdowns`, `dropdown_root`, `dropdown`, `caption_label`, `month_grid` (replaced `table`), `weekdays`, `weekday`, `week`, `week_number_header`, `week_number`, `day`, `range_start`, `range_middle`, `range_end`, `today`, `outside`, `disabled`, `hidden`

## Token delta classes applied
- Cell size: `[--cell-size:2rem]` to `[--cell-size:2.5rem]` (40px = size-10)
- Day cells: added `rounded-pill` to `CalendarDayButton` className; range start/end changed from `rounded-md` to `rounded-pill`
- Selected day: already wired by CLI via `data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground`
- Today: `bg-accent text-accent-foreground rounded-md` to `border border-ring rounded-md`
- Caption label: `font-medium` to `font-semibold`
- Nav buttons: already use `buttonVariants({ variant: buttonVariant })` defaulting to `ghost` (our Button token classes)
- Popover: `rounded-md border` to `rounded-card border border-border`; `shadow-md` to `shadow-soft-lg`

## Files changed
- **Created**: `src/components/ui/popover.tsx` (CLI + token delta)
- **Created**: `src/components/ui/calendar.tsx` (CLI + `table` to `month_grid` fix + token deltas)
- **Created**: `src/components/ui/date-picker.tsx` (hand-authored, brief spec)
- **Created**: `src/app/(dev)/ui-kit/sections/datepicker-section.tsx` (gallery)
- **Modified**: `src/app/(dev)/ui-kit/page.tsx` (import + mount DatePickerSection after TogglesSection)
- **Modified**: `package.json` + `package-lock.json` (react-day-picker, @radix-ui/react-popover added)

## Verification
`npx tsc --noEmit` filtered to new files: zero errors. Pre-existing errors unrelated to this task remain (cleaner-dashboard, MessageThread, stripe, supabase-admin -- all pre-existing per project notes).

## Self-review
- Confirmed CLI worked for both components (no crash/hang)
- Confirmed button.tsx was reverted after CLI overwrote it
- Confirmed config files untouched (tailwind.config.js, globals.css, components.json)
- Fixed one CLI scaffolding bug: `table` to `month_grid` (v10 ClassNames type requirement)
- Used `autoFocus` not `initialFocus` (v10 API)
- No em dashes in gallery copy
- `'use client'` on calendar.tsx, popover.tsx, date-picker.tsx, datepicker-section.tsx

## Concerns
None blocking. The CLI `table` key bug is a known shadcn scaffold quirk for v10 -- fixed at line 87. All token deltas applied correctly per brief.
