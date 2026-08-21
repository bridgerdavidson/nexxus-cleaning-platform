"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import imageCompression from "browser-image-compression";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { uuidv4 } from "@/lib/uuid";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deriveBrandRamp, rampToCssVars } from "@/lib/branding/palette";
import { NEXXUS_BRAND_HEX } from "@/lib/branding/tokens";
import { trimLogoWhitespace } from "@/lib/branding/trimLogo";
import { keys } from "@/lib/queryKeys";
import { updateOrgBranding } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSaveBar } from "../SettingsSaveBar";

/** For color/logos an empty string means "not set": the app shows the Nexxus default. */
interface BrandingForm {
  name: string;
  color: string;
  iconUrl: string;
  fullUrl: string;
  /** Dark-mode variants; empty falls back to the light asset at render time. */
  iconDarkUrl: string;
  fullDarkUrl: string;
  /** The branding setup step is already complete (confirmed, or branded before
   * the flag existed). Never edited by the form, so it cannot dirty it. */
  confirmed: boolean;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const ACCEPTED_TYPES = ["image/png", "image/webp"];

/** Doubles as the storage filename prefix (`<slot>-<uuid>.<ext>`), which the
 *  branding route's filename pin accepts for all four spellings. */
type LogoSlot = "icon" | "full" | "icon-dark" | "full-dark";

const SLOT_LABEL: Record<LogoSlot, string> = {
  icon: "App icon",
  full: "Full logo",
  "icon-dark": "Dark mode icon",
  "full-dark": "Dark mode logo",
};

export function BrandingSection() {
  const { currentOrganizationId, refreshOrganization } = useAuth();
  const qc = useQueryClient();
  // Flips after a successful save so the confirm bar retires immediately
  // (useSettingsSection never re-runs load after a save).
  const [confirmedNow, setConfirmedNow] = useState(false);

  // The PERSISTED logo urls, so upload cleanup can tell a staged (unsaved)
  // object apart from one the org row actually references.
  const savedUrlsRef = useRef<{ iconUrl: string; fullUrl: string; iconDarkUrl: string; fullDarkUrl: string }>(
    { iconUrl: "", fullUrl: "", iconDarkUrl: "", fullDarkUrl: "" },
  );
  const baselineUrl = (k: "iconUrl" | "fullUrl" | "iconDarkUrl" | "fullDarkUrl") =>
    savedUrlsRef.current[k];

  const load = useCallback(async (): Promise<BrandingForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("name, brand_color, logo_icon_url, logo_full_url, logo_icon_dark_url, logo_full_dark_url, branding_confirmed_at")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const form = {
      name: (data?.name as string | null) ?? "",
      color: (data?.brand_color as string | null) ?? "",
      iconUrl: (data?.logo_icon_url as string | null) ?? "",
      fullUrl: (data?.logo_full_url as string | null) ?? "",
      iconDarkUrl: (data?.logo_icon_dark_url as string | null) ?? "",
      fullDarkUrl: (data?.logo_full_dark_url as string | null) ?? "",
      // Orgs that branded themselves before the confirm flag existed should
      // not be nagged to confirm; same fallback signals as the checklist hook.
      confirmed:
        (data?.branding_confirmed_at as string | null) != null ||
        !!(data?.brand_color as string | null) ||
        !!(data?.logo_icon_url as string | null),
    };
    savedUrlsRef.current = {
      iconUrl: form.iconUrl,
      fullUrl: form.fullUrl,
      iconDarkUrl: form.iconDarkUrl,
      fullDarkUrl: form.fullDarkUrl,
    };
    return form;
  }, [currentOrganizationId]);

  const save = useCallback(
    async (v: BrandingForm) => {
      if (!currentOrganizationId) throw new Error("No organization");
      if (!v.name.trim()) throw new Error("Enter a company name.");
      await updateOrgBranding(currentOrganizationId, {
        name: v.name.trim(),
        brand_color: v.color || null,
        logo_icon_url: v.iconUrl || null,
        logo_full_url: v.fullUrl || null,
        logo_icon_dark_url: v.iconDarkUrl || null,
        logo_full_dark_url: v.fullDarkUrl || null,
      });
      savedUrlsRef.current = {
        iconUrl: v.iconUrl,
        fullUrl: v.fullUrl,
        iconDarkUrl: v.iconDarkUrl,
        fullDarkUrl: v.fullDarkUrl,
      };
      // AuthContext still holds the pre-save org row; silently refresh it so
      // BrandProvider retints the whole app right away. NOT reloadOrganization:
      // that cycles orgStatus through 'loading', which unmounts the entire
      // shell (and this view) behind FullPageLoader.
      await refreshOrganization();
      // Saving (even with untouched defaults, via "Looks good") stamps
      // branding_confirmed_at, which completes the branding setup-checklist
      // step on the overview.
      setConfirmedNow(true);
      void qc.invalidateQueries({ queryKey: keys.onboarding.operator(currentOrganizationId) });
    },
    [currentOrganizationId, refreshOrganization, qc],
  );

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<BrandingForm>({ load, save, successMessage: "Branding updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load this section" onRetry={retry} />;

  const effectiveColor = HEX_RE.test(value.color) ? value.color : NEXXUS_BRAND_HEX;
  const previewName = value.name.trim() || "Your company";
  const needsConfirm = !value.confirmed && !confirmedNow;

  return (
    <div>
      <SectionHeader
        title="Branding"
        lead="Your name, color, and logo, everywhere your team and customers see the app."
      />

      <SettingRow
        label="Company name"
        htmlFor="brand-org-name"
        helper="Shown across your app and in emails to customers."
      >
        <Input
          id="brand-org-name"
          className="sm:w-72"
          maxLength={200}
          value={value.name}
          onChange={(e) => setValue((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
        />
      </SettingRow>

      <SettingRow
        label="Brand color"
        htmlFor="brand-color-hex"
        helper="One color. Buttons, links, and highlights are derived from it."
      >
        {/* Functional updates everywhere: uploads resolve asynchronously, and a
            spread of a captured `value` would silently revert edits made while
            an upload was in flight. */}
        <ColorField
          value={value.color}
          onChange={(color) => setValue((prev) => (prev ? { ...prev, color } : prev))}
        />
      </SettingRow>

      <SettingRow
        label="App icon"
        helper="Square works best. Shown in the sidebar, tabs, and emails."
      >
        <LogoPairField
          slot="icon"
          darkSlot="icon-dark"
          url={value.iconUrl}
          darkUrl={value.iconDarkUrl}
          savedUrl={baselineUrl("iconUrl")}
          savedDarkUrl={baselineUrl("iconDarkUrl")}
          orgId={currentOrganizationId}
          onChange={(iconUrl) => setValue((prev) => (prev ? { ...prev, iconUrl } : prev))}
          onDarkChange={(iconDarkUrl) => setValue((prev) => (prev ? { ...prev, iconDarkUrl } : prev))}
        />
      </SettingRow>

      <SettingRow
        label="Full logo"
        helper="Your full lockup or wordmark. Shown when the sidebar is expanded."
      >
        <LogoPairField
          slot="full"
          darkSlot="full-dark"
          url={value.fullUrl}
          darkUrl={value.fullDarkUrl}
          savedUrl={baselineUrl("fullUrl")}
          savedDarkUrl={baselineUrl("fullDarkUrl")}
          orgId={currentOrganizationId}
          onChange={(fullUrl) => setValue((prev) => (prev ? { ...prev, fullUrl } : prev))}
          onDarkChange={(fullDarkUrl) => setValue((prev) => (prev ? { ...prev, fullDarkUrl } : prev))}
        />
      </SettingRow>

      <SettingRow
        label="Preview"
        helper="How your brand looks in the app, in light and dark mode. Updates as you edit; nothing changes until you save."
      >
        <div className="grid gap-3">
          <BrandPreview
            mode="light"
            color={effectiveColor}
            iconUrl={value.iconUrl}
            fullUrl={value.fullUrl}
            orgName={previewName}
          />
          <BrandPreview
            mode="dark"
            color={effectiveColor}
            iconUrl={value.iconDarkUrl || value.iconUrl}
            fullUrl={value.fullDarkUrl || value.fullUrl}
            orgName={previewName}
          />
          {(value.iconUrl || value.fullUrl) && !value.iconDarkUrl && !value.fullDarkUrl ? (
            <p className="max-w-72 text-sm text-muted-foreground">
              This is how your logo looks in dark mode. If it is hard to see, add a dark version
              in the logo sections above.
            </p>
          ) : null}
        </div>
      </SettingRow>

      <SettingRow
        label="Reset to default"
        helper="Clears your color and logos and returns the app to the Nexxus look. Takes effect when you save."
      >
        <Button
          type="button"
          variant="outline"
          disabled={
            !value.color && !value.iconUrl && !value.fullUrl && !value.iconDarkUrl && !value.fullDarkUrl
          }
          onClick={() =>
            setValue((prev) =>
              prev
                ? { ...prev, color: "", iconUrl: "", fullUrl: "", iconDarkUrl: "", fullDarkUrl: "" }
                : prev,
            )
          }
        >
          Reset to default
        </Button>
      </SettingRow>

      <SettingsSaveBar
        visible={isDirty || needsConfirm}
        saving={saving}
        onSave={onSave}
        onDiscard={onDiscard}
        message={isDirty ? "Unsaved changes" : "Confirm your branding to finish this setup step"}
        saveLabel={isDirty ? "Save changes" : "Looks good"}
        showDiscard={isDirty}
      />
    </div>
  );
}

/** Native color swatch + hex text field, kept in sync. Text commits on blur. */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Re-sync the draft when the form value changes from elsewhere (reset, swatch).
  const lastValue = useRef(value);
  if (lastValue.current !== value) {
    lastValue.current = value;
    if (draft !== value) setDraft(value);
    if (error) setError(null);
  }

  function commit(text: string) {
    const t = text.trim();
    if (t === "") {
      setError(null);
      onChange("");
      return;
    }
    const withHash = t.startsWith("#") ? t : `#${t}`;
    if (!HEX_RE.test(withHash)) {
      setError("Use a 6-digit hex color like #0150FC.");
      return;
    }
    setError(null);
    onChange(withHash.toUpperCase());
  }

  return (
    <div className="sm:w-72">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a brand color"
          className="h-11 w-14 shrink-0 cursor-pointer rounded-control border border-border bg-card p-1"
          value={HEX_RE.test(value) ? value : NEXXUS_BRAND_HEX}
          onChange={(e) => {
            setError(null);
            onChange(e.target.value.toUpperCase());
          }}
        />
        <Input
          id="brand-color-hex"
          className="flex-1"
          placeholder="Default"
          value={draft}
          maxLength={7}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
          aria-invalid={!!error}
          aria-describedby={error ? "brand-color-error" : undefined}
        />
      </div>
      {error ? (
        <p id="brand-color-error" role="alert" className="mt-1.5 text-sm text-critical-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One brand asset as a Light/Dark surface tile pair. The Dark tile always
 * shows what dark-mode users actually see: the uploaded dark variant, or the
 * light asset on the dark canvas ("Same as light", the render-time fallback).
 * There is no toggle: the state IS whether a dark image exists, and the X on
 * the dark tile returns to same-as-light. Each tile pins its own theme via
 * the scope classes, so both render truthfully whatever theme the settings
 * page itself is in.
 */
function LogoPairField({
  slot,
  darkSlot,
  url,
  darkUrl,
  savedUrl,
  savedDarkUrl,
  orgId,
  onChange,
  onDarkChange,
}: {
  slot: LogoSlot;
  darkSlot: LogoSlot;
  url: string;
  darkUrl: string;
  savedUrl: string;
  savedDarkUrl: string;
  orgId: string | null;
  onChange: (url: string) => void;
  onDarkChange: (url: string) => void;
}) {
  const light = useLogoUpload(slot, url, savedUrl, orgId, onChange);
  const dark = useLogoUpload(darkSlot, darkUrl, savedDarkUrl, orgId, onDarkChange);
  const darkShownUrl = darkUrl || url;

  return (
    <div className="grid gap-2 sm:w-72">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid content-start gap-1.5">
          <p className="px-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Light mode
          </p>
          <LogoSurfaceTile mode="light" empty={!url}>
            {url ? (
              /* eslint-disable-next-line @next/next/no-img-element -- storage URL, unoptimized preview */
              <img src={url} alt={SLOT_LABEL[slot]} className="max-h-12 max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo yet</span>
            )}
          </LogoSurfaceTile>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              loading={light.uploading}
              disabled={!orgId}
              onClick={light.openPicker}
            >
              {url ? "Replace" : "Upload"}
            </Button>
            {url ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 px-2"
                aria-label={`Remove ${SLOT_LABEL[slot].toLowerCase()}`}
                onClick={() => {
                  discardStagedObject(url, savedUrl);
                  onChange("");
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid content-start gap-1.5">
          <p className="px-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Dark mode
          </p>
          <LogoSurfaceTile mode="dark" empty={!darkShownUrl}>
            {darkShownUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- storage URL, unoptimized preview */
              <img
                src={darkShownUrl}
                alt={SLOT_LABEL[darkSlot]}
                className="max-h-12 max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">No logo yet</span>
            )}
          </LogoSurfaceTile>
          {darkUrl ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                loading={dark.uploading}
                disabled={!orgId}
                onClick={dark.openPicker}
              >
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 px-2"
                aria-label="Use the light version in dark mode"
                onClick={() => {
                  discardStagedObject(darkUrl, savedDarkUrl);
                  onDarkChange("");
                }}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={dark.uploading}
                disabled={!orgId}
                onClick={dark.openPicker}
              >
                Add dark version
              </Button>
              {url ? (
                <p className="px-0.5 text-[11px] text-muted-foreground">Same as light</p>
              ) : null}
            </>
          )}
        </div>
      </div>
      {light.error ? (
        <p role="alert" className="text-sm text-critical-700">
          {light.error}
        </p>
      ) : null}
      {dark.error ? (
        <p role="alert" className="text-sm text-critical-700">
          {dark.error}
        </p>
      ) : null}
      {light.inputNode}
      {dark.inputNode}
    </div>
  );
}

/** The themed surface a logo sits on: light or dark canvas, pinned locally. */
function LogoSurfaceTile({
  mode,
  empty,
  children,
}: {
  mode: "light" | "dark";
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid h-20 place-items-center overflow-hidden rounded-control border border-border bg-background p-2",
        mode === "dark" ? "dark" : "theme-scope-light",
        empty && "border-dashed",
      )}
    >
      {children}
    </div>
  );
}

/** Best-effort delete of a STAGED (never saved) upload; failures are ignored. */
function discardStagedObject(url: string, savedUrl: string) {
  if (!url || url === savedUrl) return;
  const marker = "/object/public/org-branding/";
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length).split("?")[0];
  void supabase.storage
    .from("org-branding")
    .remove([path])
    .catch(() => {
      /* orphan stays; harmless */
    });
}

/**
 * Upload pipeline for one logo slot (trim, compress, upload, stage). Returns
 * the picker trigger plus a hidden input node the caller must render.
 * `savedUrl` is the persisted URL, so replacing a staged upload can clean it up.
 */
function useLogoUpload(
  slot: LogoSlot,
  url: string,
  savedUrl: string,
  orgId: string | null,
  onChange: (url: string) => void,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!orgId) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("PNG or WebP only.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      // Trim the padding border first: logo exports routinely waste half the
      // canvas on whitespace, and every render surface sizes by bounding box,
      // so padding directly shrinks the visible mark on every screen.
      const trimmed = await trimLogoWhitespace(file);
      const compressed = await imageCompression(trimmed, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1024,
        useWebWorker: true,
      });
      // Type from the PROCESSED blob, not the input: Safari cannot encode
      // WebP, so canvas re-encodes fall back to PNG bytes.
      const outType = compressed.type === "image/webp" ? "image/webp" : "image/png";
      const ext = outType === "image/webp" ? "webp" : "png";
      // uuidv4 helper, not crypto.randomUUID: the latter is undefined outside
      // secure contexts (e.g. phone-on-LAN testing against a dev box).
      const path = `${orgId}/${slot}-${uuidv4()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("org-branding")
        .upload(path, compressed, { contentType: outType });
      if (uploadError) throw new Error(uploadError.message);
      const { data } = supabase.storage.from("org-branding").getPublicUrl(path);
      discardStagedObject(url, savedUrl);
      onChange(data.publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const inputNode = (
    <input
      ref={inputRef}
      type="file"
      accept="image/png, image/webp"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void handleFile(file);
      }}
    />
  );

  return {
    uploading,
    error,
    openPicker: () => {
      setError(null);
      inputRef.current?.click();
    },
    inputNode,
  };
}

/**
 * Miniature app composition driven by the STAGED color: the derived ramp is
 * applied as local CSS variables on the wrapper, so tokens inside resolve to
 * the draft brand while the real app keeps the saved one until save.
 *
 * The wrapper also pins its THEME locally: `dark` re-declares the dark token
 * set on the card (class-scoped in globals.css), and `theme-scope-light`
 * re-pins the light set, so each card renders its own theme no matter which
 * theme the settings page itself is in. The alias re-map below stays anyway:
 * it must not depend on the scope classes being present.
 */
function BrandPreview({
  mode,
  color,
  iconUrl,
  fullUrl,
  orgName,
}: {
  mode: "light" | "dark";
  color: string;
  iconUrl: string;
  /** Full lockup: when present it replaces icon + name in the header, mirroring OrgLogo. */
  fullUrl: string;
  orgName: string;
}) {
  const vars = useMemo(() => {
    const ramp = rampToCssVars(deriveBrandRamp(color));
    // Semantic tokens resolve their var(--brand-*) references AT :root and
    // inherit down already-resolved, so overriding --brand-* here alone
    // would not reach bg-primary etc. Re-derive them locally, per theme
    // (mirrors :root vs .dark in globals.css).
    return mode === "dark"
      ? {
          ...ramp,
          "--primary": ramp["--brand-500"],
          "--primary-foreground": ramp["--brand-fg-500"],
          "--ring": ramp["--brand-400"],
          "--brand-ink": ramp["--brand-ink-on-dark"],
        }
      : {
          ...ramp,
          "--primary": ramp["--brand-600"],
          "--primary-foreground": ramp["--brand-fg-600"],
          "--accent": ramp["--brand-50"],
          "--accent-foreground": ramp["--brand-700"],
          "--ring": ramp["--brand-600"],
          "--brand-ink": ramp["--brand-ink-on-light"],
        };
  }, [color, mode]);
  const initial = (orgName.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="w-full sm:w-72">
      <p className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {mode === "dark" ? "Dark mode" : "Light mode"}
      </p>
      <div
        style={vars as React.CSSProperties}
        className={cn(
          "w-full overflow-hidden rounded-card border border-border bg-background",
          mode === "dark" ? "dark" : "theme-scope-light",
        )}
      >
        <div className="flex h-9 items-center gap-2 border-b border-border bg-card px-3">
          {fullUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- storage URL, unoptimized preview */
            <img src={fullUrl} alt={orgName} className="h-5 max-w-[180px] object-contain object-left" />
          ) : (
            <>
              {iconUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element -- storage URL, unoptimized preview */
                <img src={iconUrl} alt="" className="h-5 w-5 object-contain" />
              ) : (
                <span className="grid h-5 w-5 place-items-center rounded-md bg-primary text-[10px] font-extrabold text-primary-foreground">
                  {initial}
                </span>
              )}
              <span className="truncate text-xs font-bold text-foreground">{orgName}</span>
            </>
          )}
        </div>
        <div className="space-y-2 p-3">
          {/* Chip styling is pinned per mode prop, NOT via dark: variants:
              dark: keys off html.dark, so it would leak the page's theme into
              the card that is deliberately showing the OTHER theme. */}
          <span
            className={cn(
              "inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-bold",
              mode === "dark" ? "bg-brand-500/15 text-brand-ink" : "bg-brand-50 text-brand-700",
            )}
          >
            Bookings
          </span>
          <div>
            <span className="inline-flex items-center rounded-pill bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
              New booking
            </span>
          </div>
          <div>
            <span
              className={cn(
                "inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-bold",
                mode === "dark" ? "bg-positive/15 text-positive" : "bg-positive-50 text-positive-700",
              )}
            >
              Confirmed
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
