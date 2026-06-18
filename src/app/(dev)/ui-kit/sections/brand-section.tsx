import { Logo } from '@/components/ui/logo'
import { Section, Specimen } from './section'

export function BrandSection() {
  return (
    <Section id="brand" title="Brand">
      <Specimen label="Full lockup (theme-aware)"><Logo variant="full" /></Specimen>
      <Specimen label="Mark, color"><Logo variant="mark" tone="color" /></Specimen>
      <Specimen label="Mark, mono (theme-aware)"><Logo variant="mark" tone="mono" /></Specimen>
    </Section>
  )
}
