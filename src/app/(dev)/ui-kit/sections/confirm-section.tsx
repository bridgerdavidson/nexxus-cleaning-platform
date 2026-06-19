'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Section, Specimen } from './section'

export function ConfirmSection() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleConfirm = () => {
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setOpen(false)
    }, 1500)
  }

  return (
    <Section id="confirm-dialog" title="Confirm Dialog">
      <Specimen label="Destructive confirm with loading demo">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Delete booking
        </Button>
      </Specimen>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete booking?"
        description="This action cannot be undone. The cleaner will be notified."
        confirmLabel="Delete"
        cancelLabel="Keep booking"
        destructive
        loading={loading}
        onConfirm={handleConfirm}
      />
    </Section>
  )
}
