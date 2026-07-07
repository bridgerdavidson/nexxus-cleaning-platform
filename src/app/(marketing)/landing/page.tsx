import { MarketingNav } from '@/components/marketing/MarketingNav'
import { HeroSection } from '@/components/marketing/HeroSection'
import { StorySection } from '@/components/marketing/StorySection'
import { LiveDemoSection } from '@/components/marketing/LiveDemoSection'
import { FeatureCardsSection } from '@/components/marketing/FeatureCardsSection'
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
        <StorySection />
        <LiveDemoSection />
        <FeatureCardsSection />
        <PricingSection />
        <FaqSection />
        <WaitlistSection />
      </main>
      <MarketingFooter />
    </div>
  )
}
