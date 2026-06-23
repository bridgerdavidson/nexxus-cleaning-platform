// Stripe Connect embedded-component appearance built from the redesign design
// tokens, so the embedded payouts table inherits our brand color, font, and
// radius instead of Stripe's defaults. Pure so it is unit-testable; the caller
// (PaymentsYourMoney) decides light/dark from the active theme.

export function getRedesignConnectAppearance(isDark: boolean) {
  return {
    variables: {
      colorPrimary: isDark ? "#2E62FF" : "#0150FC", // brand-500 (lifted for dark) / brand-600
      fontFamily: "Plus Jakarta Sans, system-ui, sans-serif",
      borderRadius: "14px", // control radius
      colorBackground: isDark ? "#24211B" : "#FFFFFF", // --card
      colorText: isDark ? "#F5F3EF" : "#211E1A", // --foreground
      colorDanger: "#E5484D",
    },
  } as const;
}
