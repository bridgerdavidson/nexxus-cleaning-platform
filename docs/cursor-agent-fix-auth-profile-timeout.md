# Fix: Profile “timeout” log + disappearing user name on return (Next.js + Supabase)

## 1) Issue Summary

When a user is signed in and stays on the page, everything works and the user’s name shows in the header.  
But if the user leaves the page/tab and later returns, the console shows:

- `Profile query timed out, using auth metadata only`

…and the user’s name disappears. Reloading the app makes the name appear again.

**Meaning:** The app is sometimes falling back to “auth metadata only” and overwriting the user state (often with blank name fields), even though the profile request itself is actually succeeding.

---

## 2) Debugging Recap (What We Did + What We Found)

### Network inspection
- In DevTools → **Network**, we filtered for the profile request:
  - `.../rest/v1/user_profiles?select=*&id=eq.<USER_ID>`
- We observed **many** of these requests.
- When the bug happened, **more requests appeared**, but:
  - they were **Status: success (200)**
  - and the **Response contained the correct user profile data** (including name fields)

### Request initiator
- Network “Initiator” pointed to: `useAuth.ts` (around the delay line)
- That confirmed the issue is **not Supabase failing**; it’s **our hook logic and state/concurrency**.

### Code review of `loadUserProfile`
We found:
- You’re using `Promise.race(profileQuery, timeoutPromise(5s))`
- On “timeout” you:
  - log the warning
  - build a user from auth metadata only
  - call `setUser(...)`
  - `return`
- You create an `AbortController` but **never attach it to the Supabase query**, so the request isn’t actually canceled.
- Multiple calls to `loadUserProfile` can overlap and **stale calls can overwrite a good user state** (race condition).

---

## 3) Problems Identified (Root Causes)

### Problem A — AbortController isn’t used
You create an AbortController, but you never pass its `signal` to the Supabase request.  
So when you “timeout”, the request continues running and later calls may still resolve out of order.

### Problem B — Race conditions / stale overwrites
`loadUserProfile` can be triggered multiple times:
- initial `getSession()` init path
- `onAuthStateChange` (SIGNED_IN, token refresh, etc.)
- tab visibility transitions

Without a “latest call wins” guard, an older or “fallback” call can finish later and overwrite the correct user profile state.

### Problem C — Catch block labels everything as “timeout”
Your `catch { ... }` treats *any* thrown error as “timeout”, which is misleading and causes fallback when it shouldn’t.

### Problem D — Fallback user_metadata may not contain the name
Fallback uses:
- `user.user_metadata.firstName/lastName`

If those aren’t stored in auth metadata, the fallback user ends up with blank name fields, which is why the header loses the name.

### Problem E — Duplicate profile requests
You’re triggering multiple identical profile reads. That amplifies races and makes the UI more likely to flip to a bad state.

---

## 4) Fix Plan (Implement All)

### Fix 1 — Use Supabase `.abortSignal()` instead of `Promise.race`
Supabase supports aborting a query using `.abortSignal(signal)`.

**Goal:** If 5 seconds pass, abort the actual network request (not just “give up” locally).

---

### Fix 2 — Add “Latest Call Wins” sequencing
Use a monotonic counter (`seq`) so only the latest `loadUserProfile` invocation is allowed to update state.

**Goal:** Prevent stale calls (especially fallback calls) from overwriting a successful profile load.

---

### Fix 3 — Don’t claim “timeout” for every error
Log the real error and only treat it as a timeout if it was aborted (optional).  
This improves debugging and reduces incorrect fallback behavior.

---

### Fix 4 — Ensure fallback always has a name (recommended)
Store first/last name in `user_metadata` at sign-up, or preserve the last known name locally and never “blank” it during refetch.

---

### Fix 5 — Reduce duplicate profile fetch triggers (optional but recommended)
After the “latest wins” guard, duplicates are less harmful, but still wasteful.  
Add gating/deduping so profile fetch doesn’t run multiple times unnecessarily.

---

## 5) Cursor Agent Instructions (Concrete Code Changes)

> File: `useAuth.ts`  
> Target function: `loadUserProfile`

### Step 1 — Add a sequence ref near your other refs
Inside `useAuth()`:

```ts
const profileLoadSeqRef = useRef(0);
```

---

### Step 2 — Add “latest wins” guard inside `loadUserProfile`
At the start of `loadUserProfile` (after `callId`):

```ts
const seq = ++profileLoadSeqRef.current;

const safeSetUser = (u: User) => {
  // Only the most recent invocation can update state
  if (seq !== profileLoadSeqRef.current) return;
  if (isSigningOutRef.current) return;
  setUser(u);
};
```

---

### Step 3 — Replace `Promise.race` timeout with `.abortSignal()`

#### Remove / stop using:
```ts
const profileQuery = supabase
  .from('user_profiles')
  .select('*')
  .eq('id', supabaseUser.id)
  .single();

const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Profile query timeout')), 5000)
);

profileResult = await Promise.race([profileQuery, timeoutPromise]);
```

#### Replace with:
```ts
const ac = new AbortController();
const timeoutId = setTimeout(() => ac.abort(), 5000);

const { data, error } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('id', supabaseUser.id)
  .single()
  .abortSignal(ac.signal);

clearTimeout(timeoutId);
```

> Note: This actually cancels the request when timing out, instead of letting it continue running.

---

### Step 4 — Replace all `setUser(...)` calls inside `loadUserProfile` with `safeSetUser(...)`

Within `loadUserProfile`, search for `setUser(` and replace with `safeSetUser(`.

Examples:

```ts
// BEFORE
setUser(userData);

// AFTER
safeSetUser(userData);
```

This prevents stale invocations from overwriting state.

---

### Step 5 — Fix the misleading timeout `catch` block

#### Replace:
```ts
} catch {
  console.warn(`[${callId}] Profile query timed out, using auth metadata only`);
  const userData = buildUserFromAuthOnly(supabaseUser);
  setUser(userData);
  return;
}
```

#### With:
```ts
} catch (err) {
  console.warn(`[${callId}] Profile fetch failed:`, err);
  const userData = buildUserFromAuthOnly(supabaseUser);
  safeSetUser(userData);
  return;
}
```

(Optional) If you want to label abort as timeout:
- you can check `ac.signal.aborted` (if `ac` is in scope) or inspect `err`.

---

### Step 6 — Ensure fallback contains first/last name

#### Recommended: set `user_metadata.firstName/lastName` at signup
Wherever signup occurs (your `/api/auth/signup` or equivalent), ensure metadata is set:

- `user_metadata.firstName`
- `user_metadata.lastName`
- optionally `user_metadata.role`

If you use an admin route:
- after creating the user, update metadata if needed.

> Result: even if profile fetch fails temporarily, the header still has a name.

---

### Step 7 (Optional) — Reduce duplicates
Once stable:
- Gate profile loading so you don’t call it redundantly from multiple paths.
- Consider only calling profile fetch on:
  - initial session load
  - SIGNED_IN
  - TOKEN_REFRESHED (if you really need fresh profile data)

---

## 6) Acceptance Tests (How to Verify)

1. Sign in and confirm the user’s name appears.
2. Navigate away or switch tabs for a bit, then return.
3. Confirm:
   - the name does **not** disappear
   - no misleading “timed out” warnings for successful requests
4. Confirm network can still show profile requests, but the UI remains stable.
5. Optional: throttle network to “Slow 3G” and confirm:
   - request aborts after ~5s
   - fallback uses metadata name (not blank)
   - once connectivity improves, next successful fetch updates the name

---

## Expected Outcome

After these changes:
- Profile requests will be **properly cancelable** (no fake timeouts)
- Only the **latest** profile load can update state (no stale overwrites)
- Fallback will still show a name (via metadata or preserved display)
- The header will not lose the user’s name when returning to the app
