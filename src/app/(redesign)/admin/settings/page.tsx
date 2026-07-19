"use client";

import { Suspense } from "react";
import { OperatorSettings } from "@/components/redesign/settings/OperatorSettings";
import { ContentLoading } from "@/components/redesign/shared/ContentLoading";

// Auth/org guarding and the shell live in ../layout.tsx. Settings has no
// per-screen permission flag: every operator can open it.
export default function OperatorSettingsPage() {
  return (
    <Suspense fallback={<ContentLoading />}>
      <OperatorSettings />
    </Suspense>
  );
}
