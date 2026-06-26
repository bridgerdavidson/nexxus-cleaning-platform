"use client";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { useRegisterSettingsGuard } from "./SettingsNavGuard";

export function isFormDirty<T>(a: T, b: T): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Shared state machine for a settings form section: load once, track a dirty baseline,
 * save explicitly (toast on success/failure), and register a leave-guard.
 * Pass `load`/`save` wrapped in useCallback so the guard does not re-register every render.
 */
export function useSettingsSection<T>(opts: {
  load: () => Promise<T>;
  save: (value: T) => Promise<void>;
  successMessage: string;
}) {
  const { load, save, successMessage } = opts;
  const { showToast } = useToast();
  const [value, setValue] = useState<T | null>(null);
  const [baseline, setBaseline] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load()
      .then((v) => { if (alive) { setValue(v); setBaseline(v); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setLoadError(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { alive = false; };
  }, [load]);

  const isDirty = value != null && baseline != null && isFormDirty(value, baseline);

  const onSave = useCallback(async (): Promise<boolean> => {
    if (value == null) return false;
    setSaving(true);
    try {
      await save(value);
      setBaseline(value);
      showToast(successMessage, { variant: "success" });
      return true;
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Could not save changes", { variant: "error" });
      return false;
    } finally {
      setSaving(false);
    }
  }, [value, save, successMessage, showToast]);

  const onDiscard = useCallback(() => setValue(baseline), [baseline]);

  useRegisterSettingsGuard({ isDirty, save: onSave });

  return { value, setValue, baseline, loading, saving, isDirty, loadError, onSave, onDiscard };
}
