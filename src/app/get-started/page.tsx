import { notFound } from 'next/navigation'

// Placeholder claim on the /get-started URL: the marketing "Try it out" CTAs
// point here. The subscription-billing phase replaces this with the real
// signup + checkout flow; until then the route intentionally 404s.
export default function GetStartedPage() {
  notFound()
}
