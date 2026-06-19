'use client'

import * as React from 'react'
import { Section, Specimen } from './section'
import { DatePicker } from '@/components/ui/date-picker'
import { Calendar } from '@/components/ui/calendar'

export function DatePickerSection() {
  const [date, setDate] = React.useState<Date | undefined>()

  return (
    <Section id="datepicker" title="Calendar and DatePicker">
      <Specimen label="DatePicker (popover-anchored)">
        <DatePicker value={date} onChange={setDate} placeholder="Pick a date" />
      </Specimen>

      <Specimen label="Calendar (static, always open)" className="items-start">
        <Calendar
          mode="single"
          selected={new Date(2026, 5, 18)}
          onSelect={() => undefined}
        />
      </Specimen>
    </Section>
  )
}
