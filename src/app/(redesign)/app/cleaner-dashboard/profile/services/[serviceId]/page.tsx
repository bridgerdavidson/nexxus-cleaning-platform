"use client";

import { useParams } from "next/navigation";
import { CleanerServiceDetail } from "@/components/redesign/cleaner/profile/CleanerServiceDetail";

export default function CleanerServiceDetailPage() {
  const params = useParams<{ serviceId: string }>();
  return <CleanerServiceDetail serviceId={params?.serviceId ?? ""} />;
}
