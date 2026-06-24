'use client'
import React, { useRef, useState } from 'react'
import { OperatorShell } from '@/components/redesign/shell/OperatorShell'
import { OperatorMessagesView } from '@/components/redesign/messages/OperatorMessagesView'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { ConversationRowVM, MessageVM, ContactContextVM, ContactBookingVM, RoleFilter } from '@/components/redesign/messages/messages-types'

const ROWS: ConversationRowVM[] = [
  { id: 'a', participantId: 'u1', name: 'Jordan Avery', email: 'jordan@x.com', role: 'homeowner', initials: 'JA', avatarUrl: null, preview: 'Can we move Friday to the morning?', timeLabel: '2m', unreadCount: 2, hasBooking: true, lastMessageAt: '2026-06-24T17:58:00Z' },
  { id: 'b', participantId: 'u2', name: 'Wanda Jacobs', email: 'wanda@x.com', role: 'cleaner', initials: 'WJ', avatarUrl: null, preview: 'Running 10 min late to the Oak St job', timeLabel: '18m', unreadCount: 1, hasBooking: false, lastMessageAt: '2026-06-24T17:42:00Z' },
  { id: 'c', participantId: 'u3', name: 'Marcus Lee', email: 'marcus@x.com', role: 'manager', initials: 'ML', avatarUrl: null, preview: 'Approved the payout, thanks', timeLabel: '1h', unreadCount: 0, hasBooking: false, lastMessageAt: '2026-06-24T17:00:00Z' },
]
const MESSAGES: MessageVM[] = [
  { id: 'm0', senderId: 'me', isMine: true, content: '', timeLabel: '2:38 PM', isRead: true, attachments: [], createdAt: '2026-06-24T14:38:00Z', dayLabel: 'Today', showDayDivider: true,
    booking: { appointmentId: 'ap1', found: true, service: 'Deep Clean', dateLabel: 'Fri Jun 27', timeLabel: '2:00 PM', address: '123 Oak St', cleanerName: 'Wanda Jacobs', status: 'confirmed' } },
  { id: 'm1', senderId: 'me', isMine: true, content: "Hi Jordan, quick question about Friday's clean.", timeLabel: '2:38 PM', isRead: true, attachments: [], booking: null, createdAt: '2026-06-24T14:38:30Z', dayLabel: 'Today', showDayDivider: false },
  { id: 'm2', senderId: 'u1', isMine: false, content: 'Can we move it to the morning instead?', timeLabel: '2:41 PM', isRead: false, attachments: [], booking: null, createdAt: '2026-06-24T14:41:00Z', dayLabel: 'Today', showDayDivider: false },
]
const BOOKINGS: ContactBookingVM[] = [
  { appointmentId: 'ap1', service: 'Deep Clean', dateLabel: 'Jun 27', timeLabel: '2:00 PM', address: '123 Oak St', status: 'confirmed', dayNum: '27', monthLabel: 'Jun' },
  { appointmentId: 'ap2', service: 'Standard Clean', dateLabel: 'Jun 13', timeLabel: '10:00 AM', address: '123 Oak St', status: 'completed', dayNum: '13', monthLabel: 'Jun' },
]
const CONTEXT: ContactContextVM = {
  id: 'u1', name: 'Jordan Avery', role: 'homeowner', initials: 'JA', avatarUrl: null, email: 'jordan.avery@gmail.com', phone: '(801) 555-0142',
  cleaningsCount: 14, lifetimeLabel: '$1,680.00', propertiesCount: 2, upcoming: [BOOKINGS[0]], recent: [BOOKINGS[1]],
}

export default function MessagesPreviewPage() {
  const endRef = useRef<HTMLDivElement>(null) as React.RefObject<HTMLDivElement>
  const isMobile = useIsMobile('(max-width: 1023px)')
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>('a')
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [draft, setDraft] = useState('')

  return (
    <OperatorShell active="messages">
      <OperatorMessagesView
        rows={ROWS} totalConversations={ROWS.length} unreadTotal={3}
        search={search} onSearchChange={setSearch}
        unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly}
        roleFilter={roleFilter} onRoleFilterChange={setRoleFilter}
        roleOptions={[{ value: 'all', label: 'All roles' }, { value: 'homeowner', label: 'Homeowners' }, { value: 'cleaner', label: 'Cleaners' }, { value: 'manager', label: 'Managers' }, { value: 'admin', label: 'Admins' }]}
        selectedId={selectedId} onSelect={(id) => setSelectedId(id || null)} onRequestDelete={() => {}} onNewMessage={() => {}}
        inboxLoading={false}
        threadTitle="Jordan Avery" threadRole="homeowner" threadInitials="JA" threadAvatarUrl={null}
        messages={MESSAGES} threadLoading={false} hasMore={false} isLoadingMore={false} onLoadMore={() => {}} messagesEndRef={endRef}
        onOpenBooking={() => {}}
        draft={draft} onDraftChange={setDraft} pendingFiles={[]} onAddFiles={() => {}} onRemoveFile={() => {}}
        stagedBooking={null} attachableBookings={BOOKINGS} onStageBooking={() => {}} onClearStagedBooking={() => {}}
        onSend={() => {}} sending={false}
        detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((v) => !v)} context={CONTEXT}
        onViewProfile={() => {}} onNewBooking={() => {}} onCopy={() => {}}
        isMobile={isMobile}
      />
    </OperatorShell>
  )
}
