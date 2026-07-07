import { Building2, Home, KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

const USE_CASES = [
  {
    icon: Home,
    title: 'Cleaning companies',
    body: 'Residential and recurring routes, crews, and customers who book and pay online. The core Nexxus is built for you.',
  },
  {
    icon: Building2,
    title: 'Commercial and facility crews',
    body: 'Offices, gyms, short-term rentals. Custom service types and checklists match the way your teams actually clean.',
  },
  {
    icon: KeyRound,
    title: 'Property turnovers',
    body: 'Own the properties you clean? Skip the customer entirely. Book a turnover, pay from the company card, and send every dollar to the cleaner.',
  },
]

export function FlexibilitySection() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="secondary">Not just for one kind of company</Badge>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          If your business runs on cleaning, it fits
        </h2>
        <p className="mt-3 text-base font-medium text-muted-foreground">
          Same platform, shaped to your operation. Custom services, your own properties, and payouts
          that match how your people are paid.
        </p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {USE_CASES.map((u) => (
          <Card key={u.title} className="flex flex-col p-6">
            <span className="grid size-11 place-items-center rounded-control bg-accent text-accent-foreground">
              <u.icon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-4 text-lg font-bold text-foreground">{u.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{u.body}</p>
          </Card>
        ))}
      </div>
    </section>
  )
}
