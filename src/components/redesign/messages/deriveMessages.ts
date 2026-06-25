import type { ConversationRowVM, RoleFilter } from './messages-types'

export interface DeriveMessagesOpts {
  search: string
  unreadOnly: boolean
  roleFilter: RoleFilter
}

export function deriveMessages(rows: ConversationRowVM[], opts: DeriveMessagesOpts): ConversationRowVM[] {
  const q = opts.search.trim().toLowerCase()
  return rows
    .slice() // non-mutating
    .filter((r) => {
      if (opts.unreadOnly && r.unreadCount === 0) return false
      if (opts.roleFilter !== 'all' && r.role !== opts.roleFilter) return false
      if (q && !r.name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false
      return true
    })
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
}

export function unreadTotal(rows: ConversationRowVM[]): number {
  return rows.reduce((acc, r) => acc + (r.unreadCount ?? 0), 0)
}
