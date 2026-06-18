'use client'
// src/app/(dev)/ui-kit/sections/inputs-section.tsx
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { FormField } from '@/components/ui/form-field'
import { Section, Specimen } from './section'

export function InputsSection() {
  return (
    <Section id="inputs" title="Inputs">
      <Specimen label="Default">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="input-default">Full name</Label>
          <Input id="input-default" />
        </div>
      </Specimen>

      <Specimen label="With placeholder">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="input-placeholder">Address</Label>
          <Input id="input-placeholder" placeholder="123 Main St" />
        </div>
      </Specimen>

      <Specimen label="Disabled">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="input-disabled">Account ID</Label>
          <Input id="input-disabled" defaultValue="acc_0001" disabled />
        </div>
      </Specimen>

      <Specimen label="Error state">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="input-error">Email</Label>
          <Input
            id="input-error"
            type="email"
            defaultValue="bad-email"
            aria-invalid="true"
            aria-describedby="input-error-hint"
          />
          <p id="input-error-hint" className="text-sm text-destructive">
            Enter a valid email address.
          </p>
        </div>
      </Specimen>

      <Specimen label="Input types">
        <div className="flex w-full flex-wrap gap-6">
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <Label htmlFor="input-email">Email</Label>
            <Input id="input-email" type="email" placeholder="you@example.com" />
          </div>
          <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <Label htmlFor="input-tel">Phone</Label>
            <Input id="input-tel" type="tel" placeholder="(555) 000-0000" />
          </div>
          <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
            <Label htmlFor="input-number">Amount</Label>
            <Input id="input-number" type="number" placeholder="0.00" className="tnum" />
          </div>
        </div>
      </Specimen>

      <Specimen label="Textarea">
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="textarea-notes">Special requests</Label>
          <Textarea id="textarea-notes" placeholder="Let us know anything useful for the cleaner." />
        </div>
      </Specimen>

      <Specimen label="FormField - with helper">
        <FormField
          htmlFor="ff-phone"
          label="Phone number"
          helper="We text you when the cleaner is on the way."
          className="w-full max-w-sm"
        >
          <Input id="ff-phone" type="tel" placeholder="(555) 000-0000" />
        </FormField>
      </Specimen>

      <Specimen label="FormField - with error">
        <FormField
          htmlFor="ff-email"
          label="Email"
          error="Enter a valid email address."
          className="w-full max-w-sm"
        >
          <Input
            id="ff-email"
            type="email"
            defaultValue="bad-email"
            aria-invalid="true"
          />
        </FormField>
      </Specimen>

      <Specimen label="FormField - required">
        <FormField
          htmlFor="ff-name"
          label="Full name"
          required
          className="w-full max-w-sm"
        >
          <Input id="ff-name" placeholder="Jane Smith" />
        </FormField>
      </Specimen>
    </Section>
  )
}
