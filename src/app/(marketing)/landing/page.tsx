import { MarketingNav } from '@/components/marketing/MarketingNav'
import { HeroSection } from '@/components/marketing/HeroSection'
import { LiveTrackingSection } from '@/components/marketing/LiveTrackingSection'
import { CapabilityExplorer } from '@/components/marketing/CapabilityExplorer'
import { PayModelsSection } from '@/components/marketing/PayModelsSection'
import { FlexibilitySection } from '@/components/marketing/FlexibilitySection'
import { PricingSection } from '@/components/marketing/PricingSection'
import { FaqSection } from '@/components/marketing/FaqSection'
import { WaitlistSection } from '@/components/marketing/WaitlistSection'
import { MarketingFooter } from '@/components/marketing/MarketingFooter'

export default function LandingPage() {
  return (
    <div className="scroll-smooth">
      <MarketingNav />
      <main>
        <HeroSection />
        <CapabilityExplorer />
        <LiveTrackingSection />
        <PayModelsSection />
        <FlexibilitySection />
        <PricingSection />
        <FaqSection />
        <WaitlistSection />
      </main>
      <MarketingFooter />
    </div>
  )
}
