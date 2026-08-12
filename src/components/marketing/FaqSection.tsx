import { Badge } from '@/components/ui/badge'
import { Accordion, AccordionItem } from '@/components/ui/accordion'

const FAQS = [
  {
    id: 'crew-tech',
    q: 'Do my cleaners need to be tech-savvy?',
    a: 'No. Cleaners see one screen: today’s jobs, the address, and a big Done button. If they can send a text, they can use Nexxus. Most crews are comfortable on day one.',
  },
  {
    id: 'pay-models',
    q: 'My crew is a mix of contractors and employees. Does that work?',
    a: 'Yes. Each cleaner can be on a percentage of the job, a flat rate per job, or their own requested price, all on the same crew. Hourly employees fit too: Nexxus pays your company and you run payroll on your normal schedule.',
  },
  {
    id: 'online-booking',
    q: 'Can my customers book online?',
    a: 'Yes. You get a booking page for your company where customers pick a service and a time. Bookings land straight on your calendar, and their card is saved at booking.',
  },
  {
    id: 'payments',
    q: 'How do payments and payouts work?',
    a: 'Payments run on Stripe. Your customer’s card is saved when they book and charged when the job is completed. Cleaner payouts are split out automatically, so payday is not a spreadsheet. Card processing is at cost (2.9% + 30¢), and Growth plans and up can offer ACH bank payments at 0.8% capped at $5.',
  },
  {
    id: 'white-label',
    q: 'Will my customers see Nexxus anywhere?',
    a: 'No. Your name, logo, and colors are on the whole platform: the booking page, the customer and cleaner apps, emails, and receipts. White-labeling is included on every plan, not sold back to you as an add-on.',
  },
  {
    id: 'trial',
    q: 'Do I need a credit card to start the trial?',
    a: 'No. Every company starts with a 14 day free trial at the Growth level. Pick a plan at the end of the trial and keep everything you set up.',
  },
  {
    id: 'pricing-final',
    q: 'What happens when pricing is final?',
    a: 'The numbers on this page are early access pricing. Companies that join during early access keep the rate they signed up under, even if public pricing goes up later.',
  },
  {
    id: 'migration',
    q: 'I already have customers in another system. Can I bring them over?',
    a: 'Yes. During early access we help you move your customer list, recurring schedules, and service types in personally. You will not start from a blank screen.',
  },
  {
    id: 'when',
    q: 'When does early access open?',
    a: 'We are onboarding a small group of founding companies first. Create your account and we will reach out with your start date.',
  },
]

export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Badge variant="secondary">FAQ</Badge>
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          Questions, answered
        </h2>
      </div>
      <Accordion defaultValue="crew-tech" className="mx-auto mt-10 max-w-2xl">
        {FAQS.map((faq) => (
          <AccordionItem key={faq.id} value={faq.id} title={faq.q}>
            {faq.a}
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  )
}
