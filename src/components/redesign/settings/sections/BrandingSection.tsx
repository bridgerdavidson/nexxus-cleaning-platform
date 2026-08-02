"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { Upload, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { uuidv4 } from "@/lib/uuid";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { deriveBrandRamp, rampToCssVars } from "@/lib/branding/palette";
import { NEXXUS_BRAND_HEX } from "@/lib/branding/tokens";
import { trimLogoWhitespace } from "@/lib/branding/trimLogo";
import { updateOrgBranding } from "../settings-api";
import { useSettingsSection } from "../useSettingsSection";
import { SettingRow, SectionHeader, SectionSkeleton } from "../SettingRow";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsSaveBar } from "../SettingsSaveBar";

/** Empty string means "not set": the app shows the Nexxus default. */
interface BrandingForm {
  color: string;
  iconUrl: string;
  fullUrl: string;
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const ACCEPTED_TYPES = ["image/png", "image/webp"];

type LogoSlot = "icon" | "full";

export function BrandingSection() {
  const { currentOrganizationId, currentOrganization, refreshOrganization } = useAuth();
  const orgName = currentOrganization?.name ?? "Your company";

  // The PERSISTED logo urls, so upload cleanup can tell a staged (unsaved)
  // object apart from one the org row actually references.
  const savedUrlsRef = useRef<{ iconUrl: string; fullUrl: string }>({ iconUrl: "", fullUrl: "" });
  const baselineUrl = (k: "iconUrl" | "fullUrl") => savedUrlsRef.current[k];

  const load = useCallback(async (): Promise<BrandingForm> => {
    if (!currentOrganizationId) throw new Error("No organization");
    const { data, error } = await supabase
      .from("organizations")
      .select("brand_color, logo_icon_url, logo_full_url")
      .eq("id", currentOrganizationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const form = {
      color: (data?.brand_color as string | null) ?? "",
      iconUrl: (data?.logo_icon_url as string | null) ?? "",
      fullUrl: (data?.logo_full_url as string | null) ?? "",
    };
    savedUrlsRef.current = { iconUrl: form.iconUrl, fullUrl: form.fullUrl };
    return form;
  }, [currentOrganizationId]);

  const save = useCallback(
    async (v: BrandingForm) => {
      if (!currentOrganizationId) throw new Error("No organization");
      await updateOrgBranding(currentOrganizationId, {
        brand_color: v.color || null,
        logo_icon_url: v.iconUrl || null,
        logo_full_url: v.fullUrl || null,
      });
      savedUrlsRef.current = { iconUrl: v.iconUrl, fullUrl: v.fullUrl };
      // AuthContext still holds the pre-save org row; silently refresh it so
      // BrandProvider retints the whole app right away. NOT reloadOrganization:
      // that cycles orgStatus through 'loading', which unmounts the entire
      // shell (and this view) behind FullPageLoader.
      await refreshOrganization();
    },
    [currentOrganizationId, refreshOrganization],
  );

  const { value, setValue, loading, saving, isDirty, loadError, retry, onSave, onDiscard } =
    useSettingsSection<BrandingForm>({ load, save, successMessage: "Branding updated" });

  if (loading) return <SectionSkeleton />;
  if (loadError || !value)
    return <ErrorState title="Couldn't load this section" onRetry={retry} />;

  const effectiveColor = HEX_RE.test(value.color) ? value.color : NEXXUS_BRAND_HEX;

  return (
    <div>
      <SectionHeader
        title="Branding"
        lead="Your color and logo, everywhere your team and customers see the app."
      />

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
        <LogoField
          slot="icon"
          url={value.iconUrl}
          savedUrl={baselineUrl("iconUrl")}
          orgId={currentOrganizationId}
          onChange={(iconUrl) => setValue((prev) => (prev ? { ...prev, iconUrl } : prev))}
        />
      </SettingRow>

      <SettingRow
        label="Full logo"
        helper="Your full lockup or wordmark. Shown when the sidebar is expanded."
      >
        <LogoField
          slot="full"
          url={value.fullUrl}
          savedUrl={baselineUrl("fullUrl")}
          orgId={currentOrganizationId}
          onChange={(fullUrl) => setValue((prev) => (prev ? { ...prev, fullUrl } : prev))}
        />
      </SettingRow>

      <SettingRow
        label="Preview"
        helper="How your brand looks in the app. Updates as you edit; nothing changes until you save."
      >
        <BrandPreview color={effectiveColor} iconUrl={value.iconUrl} orgName={orgName} />
      </SettingRow>

      <SettingRow
        label="Reset to default"
        helper="Clears your color and logos and returns the app to the Nexxus look. Takes effect when you save."
      >
        <Button
          type="button"
          variant="outline"
          disabled={!value.color && !value.iconUrl && !value.fullUrl}
          onClick={() => setValue({ color: "", iconUrl: "", fullUrl: "" })}
        >
          Reset to default
        </Button>
      </SettingRow>

      <SettingsSaveBar visible={isDirty} saving={saving} onSave={onSave} onDiscard={onDiscard} />
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

/** Upload control for one logo slot: preview, upload/replace, remove. */
function LogoField({
  slot,
  url,
  savedUrl,
  orgId,
  onChange,
}: {
  slot: LogoSlot;
  url: string;
  /** The persisted URL, so replacing/removing a staged upload can clean it up. */
  savedUrl: string;
  orgId: string | null;
  onChange: (url: string) => void;
}) {
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

  return (
    <div className="sm:w-72">
      <div className="flex items-center gap-3">
        {url ? (
          <span className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded-control border border-border bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- storage URL, unoptimized preview */}
            <img src={url} alt={slot === "icon" ? "App icon" : "Full logo"} className="max-h-10 max-w-14 object-contain" />
          </span>
        ) : null}
        <Button type="button" variant="outline" disabled={uploading || !orgId} onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden />
          {uploading ? "Uploading..." : url ? "Replace" : "Upload"}
        </Button>
        {url ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={slot === "icon" ? "Remove app icon" : "Remove full logo"}
            onClick={() => {
              setError(null);
              discardStagedObject(url, savedUrl);
              onChange("");
            }}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>
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
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-critical-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Miniature app composition driven by the STAGED color: the derived ramp is
 * applied as local CSS variables on the wrapper, so tokens inside resolve to
 * the draft brand while the real app keeps the saved one until save.
 */
function BrandPreview({ color, iconUrl, orgName }: { color: string; iconUrl: string; orgName: string }) {
  const vars = useMemo(() => {
    const ramp = rampToCssVars(deriveBrandRamp(color));
    return {
      ...ramp,
      // Semantic tokens resolve their var(--brand-*) references AT :root and
      // inherit down already-resolved, so overriding --brand-* here alone
      // would not reach bg-primary etc. Re-derive them locally.
      "--primary": ramp["--brand-600"],
      "--primary-foreground": ramp["--brand-fg-600"],
      "--accent": ramp["--brand-50"],
      "--accent-foreground": ramp["--brand-700"],
      "--ring": ramp["--brand-600"],
      "--brand-ink": ramp["--brand-ink-on-light"],
    };
  }, [color]);
  const initial = (orgName.trim()[0] ?? "?").toUpperCase();

  return (
    <div
      style={vars as React.CSSProperties}
      className="w-full overflow-hidden rounded-card border border-border bg-background sm:w-72"
    >
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        {iconUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- storage URL, unoptimized preview */
          <img src={iconUrl} alt="" className="h-5 w-5 object-contain" />
        ) : (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-primary text-[10px] font-extrabold text-primary-foreground">
            {initial}
          </span>
        )}
        <span className="truncate text-xs font-bold text-foreground">{orgName}</span>
      </div>
      <div className="space-y-2 p-3">
        <span className="inline-flex items-center rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">
          Bookings
        </span>
        <div>
          <span className="inline-flex items-center rounded-pill bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground">
            New booking
          </span>
        </div>
        <div>
          <span className="inline-flex items-center rounded-pill bg-positive-50 px-2 py-0.5 text-[11px] font-bold text-positive-700">
            Confirmed
          </span>
        </div>
      </div>
    </div>
  );
}
