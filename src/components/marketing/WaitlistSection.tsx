'use client'

import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const TEAM_SIZES = [
  { value: 'solo', label: 'Just me' },
  { value: '2-5', label: '2 to 5 cleaners' },
  { value: '6-10', label: '6 to 10 cleaners' },
  { value: '11-25', label: '11 to 25 cleaners' },
  { value: '25+', label: 'More than 25' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function WaitlistSection() {
  const [email, setEmail] = React.useState('')
  const [company, setCompany] = React.useState('')
  const [teamSize, setTeamSize] = React.useState<string>('')
  const [status, setStatus] = React.useState<Status>('idle')
  const [emailError, setEmailError] = React.useState<string | undefined>()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!EMAIL_RE.test(email)) {
      setEmailError('Enter a valid email address.')
      return
    }
    setEmailError(undefined)
    setStatus('submitting')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          companyName: company || null,
          teamSize: teamSize || null,
        }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section id="waitlist" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6 sm:pb-20">
      <div className="rounded-card bg-gradient-to-br from-brand-950 to-brand-700 px-6 py-12 text-center shadow-soft-lg sm:px-12 sm:py-16">
        <h2 className="text-3xl font-extrabold tracking-tight text-primary-foreground sm:text-4xl">
          Be first in line
        </h2>
        <p className="mx-auto mt-3 max-w-md text-base font-medium text-brand-100">
          Early access opens soon. Founding companies get hands-on onboarding and keep early
          pricing for good.
        </p>

        {status === 'success' ? (
          <div
            className="mx-auto mt-8 flex max-w-md items-center justify-center gap-2.5 rounded-field bg-card px-6 py-5 text-left shadow-soft-md"
            role="status"
          >
            <CheckCircle2 className="size-6 shrink-0 text-positive-700" aria-hidden />
            <p className="text-sm font-semibold text-foreground">
              You&apos;re on the list. We&apos;ll be in touch soon.
            </p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <FormField label="Work email" htmlFor="wl-email" required error={emailError} className="[&_label]:text-brand-100">
              <Input
                id="wl-email"
                type="email"
                autoComplete="email"
                placeholder="you@yourcompany.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Company" htmlFor="wl-company" className="[&_label]:text-brand-100">
              <Input
                id="wl-company"
                autoComplete="organization"
                placeholder="Brightside Cleaning Co"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </FormField>
            <FormField label="Team size" htmlFor="wl-team" className="[&_label]:text-brand-100">
              <Select value={teamSize} onValueChange={setTeamSize}>
                <SelectTrigger id="wl-team" aria-label="Team size">
                  <SelectValue placeholder="Team size" />
                </SelectTrigger>
                <SelectContent className="redesign-overlay">
                  {TEAM_SIZES.map((size) => (
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <Button
              type="submit"
              size="lg"
              loading={status === 'submitting'}
              className="bg-card text-accent-foreground hover:bg-card hover:brightness-95 sm:mb-0"
            >
              Join the waitlist
            </Button>
            {status === 'error' ? (
              <p className="text-sm font-semibold text-brand-100 sm:col-span-4" role="alert">
                Something went wrong on our end. Please try again in a moment.
              </p>
            ) : null}
          </form>
        )}
      </div>
    </section>
  )
}
