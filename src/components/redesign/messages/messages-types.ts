import type { UserRole } from '@/types'
import type { JobThreadRowVM } from './jobThreadRow'

export type RoleFilter = 'all' | UserRole
export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'

export interface ConversationRowVM {
  id: string                 // conversation id
  participantId: string      // other_participant.id
  name: string
  email: string              // for search (lowercased match handled in derive)
  role: UserRole
  initials: string
  avatarUrl: string | null
  preview: string            // already formatted ("You: ...", "Photo", etc.)
  timeLabel: string          // time-ago label
  unreadCount: number
  hasBooking: boolean        // last message carried an appointment_id
  lastMessageAt: string      // ISO, for sort
}

export interface InlineBookingVM {
  appointmentId: string
  found: boolean             // false => minimal fallback card (appointment not in loaded set)
  service: string
  dateLabel: string          // "Fri Jun 27"
  timeLabel: string          // "2:00 PM"
  address: string | null
  cleanerName: string | null
  status: BookingStatus
}

export interface MessageAttachmentVM {
  id: string
  url: string
}

export interface MessageVM {
  id: string
  senderId: string
  isMine: boolean
  content: string
  timeLabel: string
  isRead: boolean
  attachments: MessageAttachmentVM[]
  booking: InlineBookingVM | null
  createdAt: string          // ISO
  dayLabel: string           // "Today" / "Jun 27"
  showDayDivider: boolean    // true on the first message of a day
}

export interface ContactBookingVM {
  appointmentId: string
  service: string
  dateLabel: string          // "Jun 27"
  timeLabel: string          // "2:00 PM"
  address: string | null
  status: BookingStatus
  dayNum: string             // "27" for the date pill
  monthLabel: string         // "Jun"
}

export interface ContactContextVM {
  id: string
  name: string
  role: UserRole
  initials: string
  avatarUrl: string | null
  email: string | null
  phone: string | null
  cleaningsCount: number
  lifetimeLabel: string | null   // money2 string, or null when !canViewPayments
  propertiesCount: number | null // null when not derivable/not homeowner
  upcoming: ContactBookingVM[]
  recent: ContactBookingVM[]
}

// UserRoleLike is used by thread panel to display participant role label
export type UserRoleLike = UserRole | string

export interface OperatorMessagesViewProps {
  error?: boolean
  onRetry?: () => void
  // inbox
  rows: ConversationRowVM[]
  totalConversations: number
  unreadTotal: number
  search: string
  onSearchChange: (v: string) => void
  unreadOnly: boolean
  onUnreadOnlyChange: (v: boolean) => void
  roleFilter: RoleFilter
  roleOptions: { value: RoleFilter; label: string }[]
  onRoleFilterChange: (v: RoleFilter) => void
  selectedId: string | null
  onSelect: (conversationId: string) => void
  onRequestDelete: (conversationId: string) => void
  onNewMessage: () => void
  inboxLoading: boolean
  // read-only job-thread section (sub-project 2b)
  jobRows: JobThreadRowVM[]
  selectedJobId: string | null
  onSelectJob: (appointmentId: string) => void
  selectedJob: JobThreadRowVM | null
  // thread
  threadTitle: string
  threadRole: UserRole | null
  threadInitials: string
  threadAvatarUrl: string | null
  messages: MessageVM[]
  threadLoading: boolean
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  messagesEndRef: React.RefObject<HTMLDivElement>
  onOpenBooking: (appointmentId: string) => void
  // composer
  draft: string
  onDraftChange: (v: string) => void
  pendingFiles: File[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
  stagedBooking: ContactBookingVM | null
  onStageBooking: (appointmentId: string) => void
  onClearStagedBooking: () => void
  attachableBookings: ContactBookingVM[]
  onSend: () => void
  sending: boolean
  // about panel
  detailsOpen: boolean
  onToggleDetails: () => void
  context: ContactContextVM | null
  onViewProfile: () => void
  onNewBooking?: () => void
  onCopy: (text: string, label: string) => void
  // layout
  isMobile: boolean
}
