export type Role = 'manager' | 'executor'

export type TaskStatus = 'new' | 'in_progress' | 'review' | 'rework' | 'done'

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  rework: 'На доработке',
  done: 'Принята',
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  new: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  review: 'bg-amber-100 text-amber-700',
  rework: 'bg-red-100 text-red-700',
  done: 'bg-green-100 text-green-700',
}

export interface Profile {
  id: string
  email: string
  role: Role
}

export interface BuildObject {
  id: string
  name: string
  address: string
  created_at: string
}

export interface Task {
  id: string
  title: string
  description: string
  object_id: string
  executor_id: string | null
  status: TaskStatus
  author_id: string
  created_at: string
  objects?: BuildObject
  executor?: Pick<Profile, 'id' | 'email'>
}

export interface HistoryRow {
  id: string
  task_id: string
  actor_id: string
  from_status: TaskStatus
  to_status: TaskStatus
  comment: string | null
  created_at: string
  actor?: Pick<Profile, 'id' | 'email'>
}

/** Доступные действия над задачей для текущей роли (зеркало правил базы).
 *  Сама база всё равно проверит каждое действие заново. */
export function availableActions(
  status: TaskStatus,
  role: Role,
  userId: string,
  executorId: string | null,
): { to: TaskStatus; label: string; needsComment: boolean }[] {
  const isAssignee = executorId === userId
  const actions: { to: TaskStatus; label: string; needsComment: boolean }[] = []
  if (role === 'executor' && isAssignee) {
    if (status === 'new' || status === 'rework')
      actions.push({ to: 'in_progress', label: 'Взять в работу', needsComment: false })
    if (status === 'in_progress')
      actions.push({ to: 'review', label: 'Отправить на проверку', needsComment: false })
  }
  if (role === 'manager' && status === 'review') {
    actions.push({ to: 'done', label: 'Принять', needsComment: false })
    actions.push({ to: 'rework', label: 'Вернуть на доработку', needsComment: true })
  }
  return actions
}
