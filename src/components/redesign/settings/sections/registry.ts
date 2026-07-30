// src/components/redesign/settings/sections/registry.ts
import type { ComponentType } from "react";
import type { SettingsSectionId } from "../sections";
import { ProfileSection } from "./ProfileSection";
import { OrganizationSection } from "./OrganizationSection";
import { BrandingSection } from "./BrandingSection";
import { PaymentsSection } from "./PaymentsSection";
import { CancellationSection } from "./CancellationSection";
import { PayoutSettingsSection } from "./PayoutSettingsSection";
import { CleanerExperienceSection } from "./CleanerExperienceSection";
import { BusinessHoursSection } from "./BusinessHoursSection";

export const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  profile: ProfileSection,
  organization: OrganizationSection,
  branding: BrandingSection,
  payments: PaymentsSection,
  cancellation: CancellationSection,
  payout: PayoutSettingsSection,
  "cleaner-experience": CleanerExperienceSection,
  "business-hours": BusinessHoursSection,
};
