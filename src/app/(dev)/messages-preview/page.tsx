'use client'
import React, { useRef, useState } from 'react'
import { OperatorShell } from '@/components/redesign/shell/OperatorShell'
import { OperatorMessagesView } from '@/components/redesign/messages/OperatorMessagesView'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { ConversationRowVM, MessageVM, ContactContextVM, ContactBookingVM, RoleFilter } from '@/components/redesign/messages/messages-types'

const ROWS: ConversationRowVM[] = [
  { id: 'a', participantId: 'u1', name: 'Jordan Avery', email: 'jordan@x.com', role: 'homeowner', initials: 'JA', avatarUrl: null, preview: 'Can we move Friday to the morning?', timeLabel: '2m', unreadCount: 2, hasBooking: true, lastMessageAt: '2026-06-24T17:58:00Z' },
  { id: 'b', participantId: 'u2', name: 'Wanda Jacobs', email: 'wanda@x.com', role: 'cleaner', initials: 'WJ', avatarUrl: null, preview: 'You: The appointment for the Henderson property has been rescheduled to 06/27 at 9:44 PM, please confirm your availability', timeLabel: '18m', unreadCount: 1, hasBooking: true, lastMessageAt: '2026-06-24T17:42:00Z' },
  { id: 'c', participantId: 'u3', name: 'Marcus Lee', email: 'marcus@x.com', role: 'manager', initials: 'ML', avatarUrl: null, preview: 'Approved the payout, thanks', timeLabel: '1h', unreadCount: 0, hasBooking: false, lastMessageAt: '2026-06-24T17:00:00Z' },
  { id: 'd', participantId: 'u4', name: 'Priya Shah', email: 'priya@x.com', role: 'homeowner', initials: 'PS', avatarUrl: null, preview: 'Thank you so much, the place looks amazing', timeLabel: '3h', unreadCount: 0, hasBooking: false, lastMessageAt: '2026-06-24T15:00:00Z' },
  { id: 'e', participantId: 'u5', name: 'Diego Torres', email: 'diego@x.com', role: 'cleaner', initials: 'DT', avatarUrl: null, preview: 'You: Photos uploaded for 412 Pine St', timeLabel: '1d', unreadCount: 0, hasBooking: true, lastMessageAt: '2026-06-23T19:00:00Z' },
]
const MESSAGES: MessageVM[] = [
  // timeLabels are relative (timeAgo vocabulary), matching production toMessageVM.
  { id: 'm0', senderId: 'me', isMine: true, content: '', timeLabel: '22m', isRead: true, attachments: [], createdAt: '2026-06-24T14:38:00Z', dayLabel: 'Today', showDayDivider: true,
    booking: { appointmentId: 'ap1', found: true, service: 'Deep Clean', dateLabel: 'Fri, Jun 27', timeLabel: '2:00 PM', address: '123 Oak St', cleanerName: 'Wanda Jacobs', status: 'confirmed' } },
  { id: 'm1', senderId: 'me', isMine: true, content: "Hi Jordan, quick question about Friday's clean.", timeLabel: '22m', isRead: true, attachments: [], booking: null, createdAt: '2026-06-24T14:38:30Z', dayLabel: 'Today', showDayDivider: false },
  { id: 'm2', senderId: 'u1', isMine: false, content: 'Can we move it to the morning instead?', timeLabel: '19m', isRead: false, attachments: [], booking: null, createdAt: '2026-06-24T14:41:00Z', dayLabel: 'Today', showDayDivider: false },
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [draft, setDraft] = useState('')

  return (
    <OperatorShell active="messages">
      <OperatorMessagesView
        rows={ROWS} unreadTotal={3}
        search={search} onSearchChange={setSearch}
        unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly}
        roleFilter={roleFilter} onRoleFilterChange={setRoleFilter}
        roleOptions={[{ value: 'all', label: 'All roles' }, { value: 'homeowner', label: 'Homeowners' }, { value: 'cleaner', label: 'Cleaners' }, { value: 'manager', label: 'Managers' }, { value: 'admin', label: 'Admins' }]}
        selectedId={selectedId} onSelect={(id) => setSelectedId(id || null)} onRequestDelete={() => {}} onNewMessage={() => {}}
        inboxLoading={false}
        jobRows={[{ appointmentId: 'ap1', cleanerId: 'u2', title: 'Jordan Avery and Wanda Jacobs', dateLabel: 'Jun 27', preview: 'Gate code is 4821, park in the driveway', timeLabel: '1h', unreadCount: 0 }]}
        selectedJobId={null} onSelectJob={() => {}} selectedJob={null}
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
