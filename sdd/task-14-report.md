# Task 14: Fix Nested Label in RadioGroup Gallery

## Before
```tsx
<label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
  <RadioGroupItem value="weekly" id="rg-weekly" />
  <Label htmlFor="rg-weekly" className="cursor-pointer font-normal">Weekly</Label>
</label>
```

## After
```tsx
<label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
  <RadioGroupItem value="weekly" id="rg-weekly" />
  <span className="text-sm text-foreground select-none">Weekly</span>
</label>
```

## TypeScript Verification
```
$ npx tsc --noEmit
(Pre-existing errors in other files; toggles-section.tsx has no NEW errors)
```

## Summary
- Replaced 4 nested `<Label>` components with `<span>` in RadioGroup rows only
- Removed unused `Label` import
- Checkbox and Switch sections unchanged
- No new TypeScript errors introduced
