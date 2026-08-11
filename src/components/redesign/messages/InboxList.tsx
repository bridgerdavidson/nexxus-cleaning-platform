'use client'

import { MessageSquare, Plus, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ConversationRow } from './ConversationRow'
import { JobThreadInboxRow } from './JobThreadInboxRow'
import type { ConversationRowVM, RoleFilter } from './messages-types'
import type { JobThreadRowVM } from './jobThreadRow'

export function InboxList(props: {
  rows: ConversationRowVM[]
  unreadTotal: number
  search: string
  onSearchChange: (v: string) => void
  unreadOnly: boolean
  onUnreadOnlyChange: (v: boolean) => void
  roleFilter: RoleFilter
  roleOptions: { value: RoleFilter; label: string }[]
  onRoleFilterChange: (v: RoleFilter) => void
  selectedId: string | null
  onSelect: (id: string) => void
  onRequestDelete: (id: string) => void
  onNewMessage: () => void
  loading: boolean
  // Optional read-only job-thread section (sub-project 2b). Omitted -> office-only.
  jobRows?: JobThreadRowVM[]
  selectedJobId?: string | null
  onSelectJob?: (appointmentId: string) => void
}) {
  const filterOptions: { value: 'all' | 'unread'; label: string }[] = [
    { value: 'all', label: 'All' },
    {
      value: 'unread',
      label: props.unreadTotal > 0 ? `Unread (${props.unreadTotal})` : 'Unread',
    },
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Search + New message header */}
      <div className="border-b border-border/60 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              placeholder="Search conversations"
              className="h-11 pl-9"
              aria-label="Search conversations"
            />
          </div>
          <IconButton
            aria-label="New message"
            className="h-11 w-11 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={props.onNewMessage}
          >
            <Plus className="size-5" />
          </IconButton>
        </div>

        {/* Filter row: compact, left-aligned (segment hugs its content, never stretches) */}
        <div className="mt-3 flex items-center gap-2">
          <SegmentedControl<'all' | 'unread'>
            options={filterOptions}
            value={props.unreadOnly ? 'unread' : 'all'}
            onChange={(v) => props.onUnreadOnlyChange(v === 'unread')}
            className="shrink-0 [&>button]:h-10"
          />
          <Select
            value={props.roleFilter}
            onValueChange={(v) => props.onRoleFilterChange(v as RoleFilter)}
          >
            <SelectTrigger className="h-11 w-[128px] shrink-0" aria-label="Filter by role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.roleOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conversation list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : props.rows.length === 0 && (!props.jobRows || props.jobRows.length === 0) ? (
          <EmptyState
            icon={<MessageSquare />}
            title={
              props.search || props.unreadOnly || props.roleFilter !== 'all'
                ? 'No matches'
                : 'No conversations yet'
            }
            description={
              props.search
                ? 'Try a different search.'
                : 'Start a conversation with the New message button.'
            }
          />
        ) : (
          <>
            {props.rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                active={row.id === props.selectedId}
                onSelect={() => props.onSelect(row.id)}
                onDelete={() => props.onRequestDelete(row.id)}
              />
            ))}
            {props.jobRows && props.jobRows.length > 0 && (
              <div className="mt-1 border-t border-border/60 pt-2">
                <div className="flex items-center gap-2 px-4 pb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Cleaning job threads
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Read only
                  </span>
                </div>
                {props.jobRows.map((row) => (
                  <JobThreadInboxRow
                    key={row.appointmentId}
                    row={row}
                    active={row.appointmentId === props.selectedJobId}
                    onSelect={() => props.onSelectJob?.(row.appointmentId)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
