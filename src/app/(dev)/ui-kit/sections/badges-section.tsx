// src/app/(dev)/ui-kit/sections/badges-section.tsx
import { Badge } from '@/components/ui/badge'
import { StatusPill } from '@/components/ui/status-pill'
import { Section, Specimen } from './section'

export function BadgesSection() {
  return (
    <Section id="badges" title="Badge + StatusPill">
      <Specimen label="All Badge Variants">
        <Badge variant="default">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="positive">Positive</Badge>
        <Badge variant="caution">Caution</Badge>
        <Badge variant="critical">Critical</Badge>
        <Badge variant="info">Info</Badge>
      </Specimen>

      <Specimen label="StatusPill - All Domain Statuses">
        <StatusPill status="scheduled" />
        <StatusPill status="in_progress" />
        <StatusPill status="completed" />
        <StatusPill status="cancelled" />
        <StatusPill status="pending" />
      </Specimen>

      <Specimen label="StatusPill - Custom Label Override">
        <StatusPill status="scheduled" label="Upcoming" />
        <StatusPill status="completed" label="Done" />
        <StatusPill status="pending" label="Awaiting Approval" />
      </Specimen>

      <div className="rounded-control border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Accessibility note: color is never the only signal. Each StatusPill always pairs a color tint with a matching icon and label text.
      </div>
    </Section>
  )
}
