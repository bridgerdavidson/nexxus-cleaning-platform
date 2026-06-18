'use client'

// src/app/(dev)/ui-kit/sections/toast-section.tsx
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Section, Specimen } from './section'

export function ToastSection() {
  return (
    <Section id="toast" title="Toast">
      <Specimen label="Success, error, and info variants">
        <Button
          variant="outline"
          onClick={() => toast.success('Booking saved')}
        >
          Success toast
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error('Card declined')}
        >
          Error toast
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast('Heads up', {
              description: 'The cleaner is on the way.',
            })
          }
        >
          Info toast
        </Button>
      </Specimen>
    </Section>
  )
}
