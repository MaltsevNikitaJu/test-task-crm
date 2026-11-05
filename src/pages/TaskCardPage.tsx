import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../api/supabase'
import type { Task, HistoryRow, TaskStatus } from '../api/types'
import { STATUS_LABELS, STATUS_COLORS, availableActions } from '../api/types'
import { useAuth } from '../auth/AuthContext'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export default function TaskCardPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { profile, session } = useAuth()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: task } = useQuery({
    queryKey: ['task', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*, objects(id, name, address), executor:profiles!tasks_executor_id_fkey(id, email)')
        .eq('id', id!).single()
      if (error) throw error
      return data as unknown as Task
    },
  })

  const { data: history } = useQuery({
    queryKey: ['history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_history')
        .select('*, actor:profiles!task_history_actor_id_fkey(id, email)')
        .eq('task_id', id!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as HistoryRow[]
    },
  })

  // смена статуса — только через функцию базы app_transition_task
  const transition = useMutation({
    mutationFn: async (to: TaskStatus) => {
      const { error } = await supabase.rpc('app_transition_task', {
        p_task: id,
        p_to: to,
        p_comment: comment || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setComment(''); setActionError(null)
      qc.invalidateQueries({ queryKey: ['task', id] })
      qc.invalidateQueries({ queryKey: ['history', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['my-tasks'] })
    },
    onError: (e: Error) => setActionError(e.message),
  })

  // правка полей менеджером (статус и исполнителя база защищает отдельно)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tasks')
        .update({ title: editTitle, description: editDesc }).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: ['task', id] })
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!task || !profile) return <div className="text-slate-400 text-sm">Загрузка…</div>

  const actions = availableActions(task.status, profile.role, session!.user.id, task.executor_id)
  const needsCommentAction = actions.find(a => a.needsComment)

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/object/${task.object_id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← {task.objects?.name}
        </Link>
        <h1 className="font-bold text-xl mt-1">{task.title}</h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[task.status]}`}>
            {STATUS_LABELS[task.status]}
          </span>
          <span className="text-xs text-slate-400">создана {fmtDate(task.created_at)}</span>
        </div>
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{task.description || 'Без описания'}</p>
        <div className="text-sm text-slate-500">
          Исполнитель: {task.executor ? task.executor.email : 'не назначен'}
        </div>

        {profile.role === 'manager' && (
          <details className="border-t border-slate-100 pt-3">
            <summary className="text-sm text-slate-500 cursor-pointer">Редактировать</summary>
            <div className="mt-2 space-y-2">
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                defaultValue={task.title} onChange={e => setEditTitle(e.target.value)} />
              <textarea className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                defaultValue={task.description} rows={2}
                onChange={e => setEditDesc(e.target.value)} />
              <button className="bg-slate-900 text-white rounded-lg px-4 py-1.5 text-sm"
                onClick={() => save.mutate()}>Сохранить</button>
              {error && <div className="text-xs text-red-600">{error}</div>}
            </div>
          </details>
        )}
      </div>

      {actions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="font-medium text-sm">Доступные действия</div>
          {needsCommentAction && (
            <textarea className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Комментарий (обязателен для возврата на доработку)"
              rows={2} value={comment} onChange={e => setComment(e.target.value)} />
          )}
          <div className="flex gap-2 flex-wrap">
            {actions.map(a => (
              <button
                key={a.to}
                disabled={transition.isPending || (a.needsComment && !comment.trim())}
                className="rounded-lg px-4 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40"
                onClick={() => transition.mutate(a.to)}
              >
                {a.label}
              </button>
            ))}
          </div>
          {actionError && <div className="text-xs text-red-600">База отклонила: {actionError}</div>}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="font-medium text-sm mb-3">История</div>
        <ul className="space-y-3">
          {history?.map(h => (
            <li key={h.id} className="text-sm border-l-2 border-slate-200 pl-3">
              <div>
                <span className="text-slate-500">{STATUS_LABELS[h.from_status]}</span>
                {' → '}
                <span className="font-medium">{STATUS_LABELS[h.to_status]}</span>
              </div>
              <div className="text-xs text-slate-400">
                {h.actor?.email ?? '—'} · {fmtDate(h.created_at)}
              </div>
              {h.comment && <div className="text-sm text-slate-600 mt-0.5">💬 {h.comment}</div>}
            </li>
          ))}
          {history?.length === 0 && <li className="text-slate-400 text-sm">Статусов ещё не было.</li>}
        </ul>
      </div>
    </div>
  )
}
