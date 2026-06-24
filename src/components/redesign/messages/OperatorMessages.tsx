'use client'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useConversations } from '@/hooks/useConversations'
import { useMessages } from '@/hooks/useMessages'
import { useSendMessage } from '@/hooks/useSendMessage'
import { useStartConversation } from '@/hooks/useStartConversation'
import { useDeleteConversation } from '@/hooks/useDeleteConversation'
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers'
import { useAdminAppointments } from '@/hooks/useAdminData'
import { useManagerPermissions } from '@/hooks/useManagerPermissions'
import { toast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useIsMobile } from '@/hooks/useIsMobile'
import { OperatorMessagesView } from './OperatorMessagesView'
import { NewMessageDialog } from './NewMessageDialog'
import { deriveMessages, unreadTotal } from './deriveMessages'
import { deriveContactBookings } from './deriveContactBookings'
import { toConversationRowVM, toMessageVM, toInlineBookingVM, toContactContext } from './messages-presenters'
import type { ContactBookingVM, RoleFilter } from './messages-types'
import type { UserRole } from '@/types'

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All roles' },
  { value: 'homeowner', label: 'Homeowners' },
  { value: 'cleaner', label: 'Cleaners' },
  { value: 'manager', label: 'Managers' },
  { value: 'admin', label: 'Admins' },
]

export default function OperatorMessages() {
  const { user, currentOrgRole } = useAuth()
  const userId = user?.id ?? ''
  const userRole = (user?.role as UserRole) ?? 'admin'
  const router = useRouter()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()

  // useManagerPermissions returns { permissions, loading, error, refetch }
  // permissions is a ManagerPermissions object or null
  const { permissions } = useManagerPermissions()
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin'
  const canViewPayments = privileged || !!permissions?.can_view_payments

  // URL-driven selection
  const selectedId = searchParams.get('c')
  const toParam = searchParams.get('to')
  const apptParam = searchParams.get('appointment')

  const setSelected = useCallback(
    (conversationId: string) => {
      const sp = new URLSearchParams(searchParams.toString())
      if (conversationId) sp.set('c', conversationId)
      else sp.delete('c')
      sp.delete('to')
      sp.delete('appointment')
      router.replace(`?${sp.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  // data — useConversations returns `loading` (maps to inboxLoading)
  const { conversations, loading: inboxLoading, updateUnreadCount } = useConversations({ userId })
  // useMessages returns `loading` (maps to threadLoading)
  const {
    messages: rawMessages,
    loading: threadLoading,
    hasMore,
    isLoadingMore,
    loadMoreMessages,
    messagesEndRef,
  } = useMessages({ conversationId: selectedId, userId, onUnreadCountUpdate: updateUnreadCount })
  const { appointments } = useAdminAppointments()
  const { members } = useOrganizationMembers({ excludeCurrentUser: true })
  const { sendMessage, sending } = useSendMessage()
  const { startConversation } = useStartConversation()
  const { deleteConversation, deleting } = useDeleteConversation()

  // local UI state
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [stagedAppointmentId, setStagedAppointmentId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const consumedToRef = useRef<string | null>(null)

  // VM build
  const rowsAll = useMemo(
    () => conversations.map((c) => toConversationRowVM(c, userId)),
    [conversations, userId],
  )
  const rows = useMemo(
    () => deriveMessages(rowsAll, { search, unreadOnly, roleFilter }),
    [rowsAll, search, unreadOnly, roleFilter],
  )

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null
  const participant = selectedConv?.other_participant ?? null

  const apptById = useMemo(() => {
    const m = new Map<string, (typeof appointments)[number]>()
    for (const a of appointments) m.set(a.id, a)
    return m
  }, [appointments])

  const messages = useMemo(() => {
    return rawMessages.map((msg, i) =>
      toMessageVM(
        msg,
        userId,
        i > 0 ? rawMessages[i - 1] : null,
        (apptId) => toInlineBookingVM(apptById.get(apptId), apptId),
      ),
    )
  }, [rawMessages, userId, apptById])

  const context = useMemo(
    () =>
      participant
        ? toContactContext(participant, appointments, { canViewPayments, today })
        : null,
    [participant, appointments, canViewPayments, today],
  )

  const attachableBookings: ContactBookingVM[] = useMemo(() => {
    if (!participant) return []
    return deriveContactBookings(
      { id: participant.id, role: (participant.role as UserRole) ?? 'homeowner' },
      appointments as never,
      { today, maxUpcoming: 50, maxRecent: 50 },
    ).all
  }, [participant, appointments, today])

  const stagedBooking = useMemo(
    () => attachableBookings.find((b) => b.appointmentId === stagedAppointmentId) ?? null,
    [attachableBookings, stagedAppointmentId],
  )

  // deep-link: ?to=<userId>(&appointment=<id>) -> start/open a thread (consumed once via ref)
  useEffect(() => {
    if (!toParam || !userId || consumedToRef.current === toParam) return
    consumedToRef.current = toParam
    if (apptParam) setStagedAppointmentId(apptParam)
    startConversation(toParam).then((res) => {
      if (res.success && res.conversationId) setSelected(res.conversationId)
    })
  }, [toParam, apptParam, userId, startConversation, setSelected])

  // handlers
  const onSend = useCallback(async () => {
    if (!participant) return
    const content = draft.trim()
    if (!content && pendingFiles.length === 0 && !stagedAppointmentId) return
    const res = await sendMessage({
      conversationId: selectedId ?? undefined,
      senderId: userId,
      recipientId: participant.id,
      content,
      attachments: pendingFiles,
      appointmentId: stagedAppointmentId ?? undefined,
    })
    if (res.success) {
      setDraft('')
      setPendingFiles([])
      setStagedAppointmentId(null)
      if (!selectedId && res.conversationId) setSelected(res.conversationId)
    } else {
      toast.error(res.error || 'Could not send the message.')
    }
  }, [participant, draft, pendingFiles, stagedAppointmentId, sendMessage, selectedId, userId, setSelected])

  const onCopy = useCallback((text: string, label: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => toast.success(`${label} copied`))
      .catch(() => {})
  }, [])

  // "Open booking" -> legacy appointment drawer on admin-dashboard
  const openBooking = useCallback(
    (id: string) => {
      router.push(`/admin-dashboard?appointment=${id}`)
    },
    [router],
  )

  const viewProfile = useCallback(() => {
    if (!participant) return
    const role = participant.role as UserRole
    const path =
      role === 'cleaner' ? '/app/admin-dashboard/cleaners' : '/app/admin-dashboard/customers'
    router.push(path)
  }, [participant, router])

  const newBooking = useCallback(() => {
    router.push('/admin-dashboard?tab=bookings&new=1')
  }, [router])

  const onPickNew = useCallback(
    async (memberId: string) => {
      setNewOpen(false)
      const res = await startConversation(memberId)
      if (res.success && res.conversationId) setSelected(res.conversationId)
      else if (!res.success) toast.error(res.error || 'Could not start the conversation.')
    },
    [startConversation, setSelected],
  )

  const confirmDelete = useCallback(async () => {
    if (!deleteId) return
    const res = await deleteConversation(deleteId)
    if (res.success) {
      if (deleteId === selectedId) setSelected('')
      setDeleteId(null)
    } else {
      toast.error(res.error || 'Could not delete the conversation.')
    }
  }, [deleteId, deleteConversation, selectedId, setSelected])

  return (
    <>
      <OperatorMessagesView
        rows={rows}
        totalConversations={rowsAll.length}
        unreadTotal={unreadTotal(rowsAll)}
        search={search}
        onSearchChange={setSearch}
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={setUnreadOnly}
        roleFilter={roleFilter}
        roleOptions={ROLE_OPTIONS}
        onRoleFilterChange={setRoleFilter}
        selectedId={selectedId}
        onSelect={setSelected}
        onRequestDelete={setDeleteId}
        onNewMessage={() => setNewOpen(true)}
        inboxLoading={inboxLoading}
        threadTitle={context?.name ?? ''}
        threadRole={(participant?.role as UserRole) ?? null}
        threadInitials={context?.initials ?? ''}
        threadAvatarUrl={context?.avatarUrl ?? null}
        messages={messages}
        threadLoading={threadLoading}
        hasMore={hasMore}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadMoreMessages}
        messagesEndRef={messagesEndRef as RefObject<HTMLDivElement>}
        onOpenBooking={openBooking}
        draft={draft}
        onDraftChange={setDraft}
        pendingFiles={pendingFiles}
        onAddFiles={(f) => setPendingFiles((p) => [...p, ...f].slice(0, 5))}
        onRemoveFile={(i) => setPendingFiles((p) => p.filter((_, idx) => idx !== i))}
        stagedBooking={stagedBooking}
        attachableBookings={attachableBookings}
        onStageBooking={setStagedAppointmentId}
        onClearStagedBooking={() => setStagedAppointmentId(null)}
        onSend={onSend}
        sending={sending}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((v) => !v)}
        context={context}
        onViewProfile={viewProfile}
        onNewBooking={newBooking}
        onCopy={onCopy}
        isMobile={isMobile}
      />
      <NewMessageDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        members={members}
        currentUserRole={userRole}
        onPick={(m) => onPickNew(m.id)}
      />
      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null)
        }}
        title="Delete conversation?"
        description="All messages will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  )
}
