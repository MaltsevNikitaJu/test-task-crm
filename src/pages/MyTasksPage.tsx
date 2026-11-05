import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../api/supabase'
import type { Task, TaskStatus } from '../api/types'
import { STATUS_LABELS, STATUS_COLORS, availableActions } from '../api/types'
import { useAuth } from '../auth/AuthContext'

const GROUPS: TaskStatus[] = ['new', 'in_progress', 'rework', 'review', 'done']

export default function MyTasksPage() {
  const qc = useQueryClient()
  const { profile, session } = useAuth()

  // RLS сам отдаёт только свои задачи: executor_id = auth.uid()
  const { data: tasks } = useQuery({
    queryKey: ['my-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, objects(id, name), executor:profiles!tasks_executor_id_fkey(id, email)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Task[]
    },
  })

  const transition = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: TaskStatus }) => {
      const { error } = await supabase.rpc('app_transition_task', {
        p_task: id, p_to: to, p_comment: null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-tasks'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  if (!profile || !session) return <div className="text-slate-400 text-sm">Загрузка…</div>

  return (
    <div className="space-y-6">
      <h1 className="font-bold text-xl">Мои задачи</h1>
      {transition.isError && (
        <div className="text-sm text-red-600">База отклонила: {(transition.error as Error).message}</div>
      )}
      {GROUPS.map(st => {
        const list = (tasks ?? []).filter(t => t.status === st)
        if (list.length === 0) return null
        return (
          <section key={st} className="space-y-2">
            <h2 className="text-sm font-medium text-slate-500 flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[st]}`}>{STATUS_LABELS[st]}</span>
              <span className="text-slate-400">{list.length}</span>
            </h2>
            <ul className="space-y-2">
              {list.map(t => {
                const acts = availableActions(t.status, profile.role, session.user.id, t.executor_id)
                return (
                  <li key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    <Link to={`/task/${t.id}`} className="flex-1 min-w-0 hover:underline">
                      <div className="font-medium truncate">{t.title}</div>
                      <div className="text-xs text-slate-500">{t.objects?.name}</div>
                    </Link>
                    {acts.map(a => (
                      <button
                        key={a.to}
                        className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 hover:bg-slate-700"
                        onClick={() => transition.mutate({ id: t.id, to: a.to })}
                      >
                        {a.label}
                      </button>
                    ))}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {tasks?.length === 0 && <div className="text-slate-400 text-sm">Пока нет задач.</div>}
    </div>
  )
}
