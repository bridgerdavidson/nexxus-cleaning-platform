'use client'

import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { rolesUserCanMessage } from '@/lib/messagingPermissions'
import type { OrganizationMember } from '@/hooks/useOrganizationMembers'
import type { UserRole } from '@/types'
import { initialsOf } from './messages-format'
import { ROLE_LABEL } from './messages-pills'
import { PersonPicker, PersonPickerRow } from './PersonPicker'

/** Operator compose picker: searches org members the current role may message. */
export function NewMessageDialog({
  open, onOpenChange, members, currentUserRole, onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: OrganizationMember[]
  currentUserRole: UserRole
  onPick: (member: OrganizationMember) => void
}) {
  const [q, setQ] = useState('')
  const allowed = useMemo(() => new Set(rolesUserCanMessage(currentUserRole)), [currentUserRole])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return members
      .filter((m) => allowed.has(m.role as UserRole))
      .filter((m) => !needle || `${m.first_name ?? ''} ${m.last_name ?? ''} ${m.email}`.toLowerCase().includes(needle))
  }, [members, allowed, q])

  return (
    <PersonPicker
      open={open}
      onOpenChange={onOpenChange}
      title="New message"
      search={{ value: q, onChange: setQ, placeholder: 'Search people' }}
    >
      {filtered.length === 0 ? (
        <EmptyState
          compact
          icon={<Users />}
          title="No one to message"
          description="No matching members you can message."
        />
      ) : (
        filtered.map((m) => (
          <PersonPickerRow
            key={m.id}
            avatarUrl={m.avatar_url}
            initials={initialsOf(m.first_name, m.last_name)}
            title={`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.email}
            subtitle={`${ROLE_LABEL[m.role] ?? m.role} · ${m.email}`}
            onSelect={() => onPick(m)}
          />
        ))
      )}
    </PersonPicker>
  )
}
