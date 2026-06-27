export type JobActionMode = "offer" | "start" | "continue" | "done" | "none";

export interface OfferSlot {
  slot_index: number;
  scheduled_date: string;
  scheduled_time: string;
}
