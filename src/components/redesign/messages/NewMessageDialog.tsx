'use client'

import { useMemo, useState } from 'react'
import { Search, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { rolesUserCanMessage } from '@/lib/messagingPermissions'
import type { OrganizationMember } from '@/hooks/useOrganizationMembers'
import type { UserRole } from '@/types'
import { initialsOf } from './messages-format'

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogHeader className="px-5 pt-5"><DialogTitle>New message</DialogTitle></DialogHeader>
        <div className="relative px-5 pt-2">
          <Search className="pointer-events-none absolute left-8 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" className="h-10 pl-9" aria-label="Search people" />
        </div>
        <div className="max-h-[50vh] min-h-0 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <EmptyState icon={<Users className="size-5" />} title="No one to message" description="No matching members you can message." />
          ) : filtered.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m)} className="flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left hover:bg-accent">
              <Avatar className="size-9 shrink-0">
                {m.avatar_url ? <AvatarImage src={m.avatar_url} alt="" /> : null}
                <AvatarFallback>{initialsOf(m.first_name, m.last_name)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.email}</span>
                <span className="block truncate text-[11px] capitalize text-muted-foreground">{m.role} · {m.email}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="h-3" />
      </DialogContent>
    </Dialog>
  )
}
