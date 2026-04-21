import type { CSSProperties } from "react";

/** Diagonal gold wash — shared by hero card and secondary CTAs (primary-50 / primary-200 / primary-100; avoids neutral grey-beige) */
export const DASHBOARD_HERO_GRADIENT =
  "linear-gradient(to bottom right, #FFFBF0 5%, rgba(253, 234, 179, 0.72) 42%, #FEF5D9 92%)";

/** Diagonal gold wash with off-white corners — admin / manager / cleaner dashboard heroes */
export const DASHBOARD_HERO_BACKGROUND: CSSProperties = {
  background: DASHBOARD_HERO_GRADIENT,
};

const heroCardBase =
  "relative overflow-hidden border border-primary-200/90 ring-1 ring-primary-300/55";

export const dashboardHeroCardDesktopClass = `${heroCardBase} rounded-[2rem] p-7 shadow-[0_8px_22px_-14px_rgba(161,98,7,0.28)]`;

export const dashboardHeroCardMobileClass = `${heroCardBase} rounded-3xl p-5 shadow-[0_4px_12px_-6px_rgba(161,98,7,0.28)]`;

/** Same gradient as hero — use with `DASHBOARD_HERO_SECONDARY_BUTTON_CLASS` */
export const DASHBOARD_HERO_SECONDARY_BUTTON_STYLE: CSSProperties = {
  background: DASHBOARD_HERO_GRADIENT,
};

/** Secondary CTA chrome (border, type) — pair with `DASHBOARD_HERO_SECONDARY_BUTTON_STYLE` */
export const DASHBOARD_HERO_SECONDARY_BUTTON_CLASS =
  "rounded-xl border border-primary-200/95 px-4 py-2 text-sm font-semibold text-primary-700 shadow-[0_1px_2px_rgba(184,137,20,0.08)] ring-1 ring-inset ring-primary-100/80 transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-50";
