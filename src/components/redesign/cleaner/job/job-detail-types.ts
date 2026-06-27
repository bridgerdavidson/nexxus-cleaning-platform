export type JobActionMode = "offer" | "start" | "continue" | "done" | "none";

// OfferSlot now lives in shared/job-presenters (single source of truth, used by
// the offer UI); deriveJobDetail re-exports it for back-compat.
