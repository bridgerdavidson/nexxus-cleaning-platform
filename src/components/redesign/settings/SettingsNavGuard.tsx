"use client";
import { createContext, useContext, useEffect } from "react";

export interface SettingsGuard {
  isDirty: boolean;
  save: () => Promise<boolean>;
}

interface GuardCtx {
  register: (g: SettingsGuard | null) => void;
}

const Ctx = createContext<GuardCtx | null>(null);

export function SettingsNavGuardProvider({
  register,
  children,
}: {
  register: (g: SettingsGuard | null) => void;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ register }}>{children}</Ctx.Provider>;
}

/** A section calls this to expose its dirty state + save handler to the container's leave guard. */
export function useRegisterSettingsGuard(guard: SettingsGuard): void {
  const ctx = useContext(Ctx);
  useEffect(() => {
    ctx?.register(guard);
    return () => ctx?.register(null);
  }, [ctx, guard.isDirty, guard.save]);
}
