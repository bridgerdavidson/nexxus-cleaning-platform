# Cursor Agent Task: Fix Mobile Safari Safe-Area / Browser-Chrome Color Mismatch and Stuck Overlay Tint

## Context

This is a Next.js + TypeScript + React web app. On mobile phones, especially iOS Safari, the areas outside the normal webpage viewport are not matching the app background:

1. The top status area above the page uses a different color than the page background.
2. The bottom area below the page / around the home indicator also uses a different color than the page background.
3. When the bottom-nav menu button opens a slide-in drawer, an opacity overlay appears over the page. After closing the drawer by clicking outside, the overlay disappears from the webpage content but the tinted overlay color appears to remain in the iOS status/safe-area area and bottom safe-area area.

Goal: make the app feel seamless on iOS Safari by ensuring the top and bottom safe areas match the app background, and ensure drawer overlays do not leave stale/tinted colors in browser/safe-area regions after closing.

---

## Likely Root Causes to Investigate

### 1. Missing or incorrect `theme-color` metadata

Mobile Safari uses the `theme-color` meta tag to determine the browser/status bar color in many cases.

Look for Next.js metadata in one of these places:

- `app/layout.tsx`
- `app/head.tsx`
- `pages/_document.tsx`
- `pages/_app.tsx`
- any custom `<Head>` usage

Check whether this exists:

```html
<meta name="theme-color" content="#YOUR_BACKGROUND_COLOR" />
```

For App Router, prefer using Next metadata:

```ts
export const metadata = {
  themeColor: '#YOUR_BACKGROUND_COLOR',
};
```

Or viewport export in newer Next versions:

```ts
import type { Viewport } from 'next';

export const viewport: Viewport = {
  themeColor: '#YOUR_BACKGROUND_COLOR',
};
```

Use the actual app background color, not a placeholder.

Important: if the app supports dark/light mode, check whether separate media-based theme colors are needed.

```tsx
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#LIGHT_BG" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#DARK_BG" />
```

---

### 2. Missing `viewport-fit=cover`

On iOS, the app may not fully extend into the safe areas unless `viewport-fit=cover` is set.

Check for the viewport meta tag.

For App Router, use:

```ts
import type { Viewport } from 'next';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#YOUR_BACKGROUND_COLOR',
};
```

For Pages Router or manual head:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

Do not duplicate conflicting viewport tags. Search the whole codebase for:

```txt
viewport
viewport-fit
initial-scale
theme-color
```

Remove or consolidate conflicting definitions.

---

### 3. `html`, `body`, or root layout background mismatch

The safe area can expose the background of `html`, `body`, or the root app wrapper. Make sure all root-level containers use the same background as the app.

Search global CSS files such as:

- `app/globals.css`
- `styles/globals.css`
- `src/app/globals.css`
- Tailwind base layer files

Verify these are set consistently:

```css
html,
body {
  min-height: 100%;
  background: #YOUR_BACKGROUND_COLOR;
}

body {
  margin: 0;
}

#__next,
#root,
main {
  background: #YOUR_BACKGROUND_COLOR;
}
```

For Next App Router, the direct root wrapper inside `app/layout.tsx` should also use the app background class/color.

Example:

```tsx
<body className="min-h-screen bg-app-background text-app-foreground">
  {children}
</body>
```

If Tailwind is used, identify the exact class used for the page background, such as `bg-background`, `bg-neutral-950`, `bg-[#101010]`, etc., then apply it consistently to `html`, `body`, and the root layout wrapper.

---

### 4. Missing safe-area padding/background on fixed bottom nav

The bottom home-indicator area can show a different color if the fixed bottom nav or page wrapper does not extend into `env(safe-area-inset-bottom)`.

Find the bottom nav component. Search for terms like:

```txt
BottomNav
bottom nav
fixed bottom
inset-x-0 bottom-0
safe-area
menu button
Drawer
Sheet
```

If the nav is fixed at the bottom, it likely needs padding that includes the safe area:

```css
.bottom-nav {
  padding-bottom: env(safe-area-inset-bottom);
  background: #YOUR_BACKGROUND_COLOR;
}
```

Tailwind arbitrary value example:

```tsx
<nav className="fixed inset-x-0 bottom-0 bg-background pb-[env(safe-area-inset-bottom)]">
```

If content is hidden behind the nav, the main page may also need bottom padding:

```tsx
<main className="pb-[calc(4rem+env(safe-area-inset-bottom))]">
```

Use the actual nav height instead of `4rem` if different.

---

### 5. Overlay is affecting the safe-area / browser color

The drawer overlay likely uses a full-screen fixed element such as:

```tsx
<div className="fixed inset-0 bg-black/50" />
```

On iOS Safari, a full-screen overlay combined with `viewport-fit=cover`, body scroll locking, backdrop blur, or dynamic viewport resizing can make the browser/safe-area tint appear stuck after the drawer closes.

Search for the drawer/menu implementation:

```txt
Drawer
Sheet
Dialog
MenuDrawer
MobileMenu
bottom nav menu
overlay
backdrop
fixed inset-0
bg-black/50
opacity
backdrop-blur
body.style.overflow
```

Check for these issues:

- Overlay remains mounted with `opacity: 0` but still influences visual compositing.
- Overlay state is not fully reset after close animation.
- Overlay has `pointer-events-none` but is still visually present in safe areas.
- Body background changes while drawer is open and is not reset.
- `document.body.style.overflow`, `position`, `top`, or background styles are modified and not restored.
- A drawer library portal renders outside the app root and uses a different background or stale overlay.
- The overlay covers `100vh` instead of using dynamic viewport units.

Prefer fully unmounting the overlay after close, or ensure the closed state has no visible background/backdrop styles.

Example pattern:

```tsx
{isMenuOpen && (
  <button
    type="button"
    aria-label="Close menu"
    className="fixed inset-0 z-40 bg-black/50"
    onClick={() => setIsMenuOpen(false)}
  />
)}
```

If animations require keeping it mounted, ensure the final closed class includes:

```tsx
opacity-0 pointer-events-none bg-transparent backdrop-blur-0
```

And remove it from the DOM after the exit animation if possible.

---

### 6. Dynamic viewport units on iOS Safari

If the app uses `h-screen`, `min-h-screen`, or `100vh`, iOS Safari can behave unexpectedly because browser chrome expands/collapses.

Search for:

```txt
h-screen
min-h-screen
100vh
height: 100vh
```

Consider replacing mobile layout wrappers with dynamic viewport units:

```tsx
<div className="min-h-dvh bg-background">
```

or CSS:

```css
.app-shell {
  min-height: 100dvh;
  background: #YOUR_BACKGROUND_COLOR;
}
```

Use `100dvh`/`min-h-dvh` for the main app shell where appropriate.

---

## Recommended Fix Strategy

Implement the fix in this order:

1. Find the app's actual background color or Tailwind background token.
2. Set that same background on `html`, `body`, and the root app shell.
3. Add or correct `viewport-fit=cover`.
4. Add or correct `theme-color` so iOS Safari uses the app background in the status/browser area.
5. Update the fixed bottom nav so its background and padding extend through `env(safe-area-inset-bottom)`.
6. Inspect the menu drawer overlay and make sure it fully unmounts or becomes truly transparent after closing.
7. Replace problematic `100vh` / `h-screen` usage in the mobile shell with `100dvh` / `min-h-dvh` where needed.

---

## Codebase Search Checklist

Run these searches in Cursor:

```txt
<meta name="theme-color"
themeColor
viewportFit
viewport-fit
<meta name="viewport"
h-screen
min-h-screen
100vh
100dvh
safe-area-inset-bottom
safe-area-inset-top
fixed inset-0
bg-black/50
backdrop-blur
overlay
Drawer
Sheet
Dialog
MobileMenu
BottomNav
bottom-0
body.style.overflow
document.body.style
```

---

## Things to Avoid

Do not only change the drawer overlay color. The root problem is likely a combination of Safari safe-area coloring, root background, and overlay lifecycle.

Do not add multiple conflicting viewport tags.

Do not hardcode a random background color if the app already uses a design token. Use the existing background variable/token/class.

Do not leave invisible overlays mounted over the entire app unless they are truly `bg-transparent`, `opacity-0`, `pointer-events-none`, and not applying `backdrop-filter`.

---

## Testing Instructions

Test on real iOS Safari if possible. Browser device emulation is not enough for this issue.

### Test 1: Initial page load

1. Open the app on iPhone Safari.
2. Confirm the top status/browser area matches the app background.
3. Confirm the bottom home-indicator area matches the app background.
4. Scroll the page if scrollable and confirm no white/default Safari area appears.

### Test 2: Drawer open

1. Tap the bottom nav menu button.
2. Confirm the overlay appears only while the drawer is open.
3. Confirm the overlay behavior looks intentional in the content area and safe areas.

### Test 3: Drawer close

1. Tap outside the drawer to close it.
2. Confirm the overlay disappears from the webpage.
3. Confirm the status area and bottom safe area return to the normal app background.
4. Repeat open/close 5+ times to check for stale overlay state.

### Test 4: Route changes

1. Navigate to other pages.
2. Confirm the safe-area colors remain consistent.
3. Open and close the menu drawer on multiple pages.

### Test 5: Dark/light mode if applicable

If the app supports themes:

1. Test light mode.
2. Test dark mode.
3. Confirm `theme-color`, root background, and drawer overlay are correct in both modes.

---

## Acceptance Criteria

The issue is fixed when:

- iOS Safari status/browser area matches the app background on initial load.
- The bottom home-indicator/safe-area region matches the app background.
- Opening the menu drawer applies the overlay only while open.
- Closing the drawer fully removes the overlay tint from content and safe areas.
- There are no conflicting viewport or theme-color declarations.
- Root background color is consistent across `html`, `body`, and app shell.
- Bottom nav accounts for `env(safe-area-inset-bottom)`.
- The fix works after route changes, refreshes, and repeated drawer open/close cycles.

---

## Example App Router Implementation Shape

Only use this as a reference. Adapt to the actual codebase and existing design tokens.

```tsx
// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';

const APP_BG = '#0b0b0f';

export const metadata: Metadata = {
  title: 'App',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: APP_BG,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-background">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

```css
/* globals.css */
html,
body {
  min-height: 100%;
  background: hsl(var(--background));
}

body {
  margin: 0;
}
```

```tsx
// Bottom nav example
<nav className="fixed inset-x-0 bottom-0 z-50 bg-background pb-[env(safe-area-inset-bottom)]">
  {/* nav content */}
</nav>
```

```tsx
// Overlay example
{isMenuOpen && (
  <button
    type="button"
    aria-label="Close menu"
    className="fixed inset-0 z-40 bg-black/50"
    onClick={() => setIsMenuOpen(false)}
  />
)}
```

---

## Final Deliverable for Cursor Agent

After inspecting the codebase, implement the smallest clean fix that satisfies the acceptance criteria. Then summarize:

1. Files changed.
2. Root cause found.
3. Why the fix works on iOS Safari.
4. Manual test results or exact steps the developer should run on a real iPhone.
