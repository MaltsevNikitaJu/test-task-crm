import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../api/supabase'
import type { BuildObject, Task, Profile, TaskStatus } from '../api/types'
import { STATUS_LABELS as LBL, STATUS_COLORS } from '../api/types'
import { useAuth } from '../auth/AuthContext'

export default function ObjectCardPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const isManager = profile?.role === 'manager'
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [executorId, setExecutorId] = useState('')

  const { data: obj } = useQuery({
    queryKey: ['object', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('objects').select('*').eq('id', id!).single()
      if (error) throw error
      return data as BuildObject
    },
  })

  const { data: tasks } = useQuery({
    queryKey: ['tasks', 'object', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, description, object_id, executor_id, status, author_id, created_at, executor:profiles!tasks_executor_id_fkey(id, email)')
        .eq('object_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as Task[]
    },
  })

  const { data: executors } = useQuery({
    queryKey: ['executors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('id, email, role').eq('role', 'executor')
      if (error) throw error
      return (data ?? []) as Profile[]
    },
    enabled: isManager,
  })

  const createTask = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tasks').insert({
        title,
        description,
        object_id: id,
        executor_id: executorId || null,
        author_id: profile!.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setTitle(''); setDescription(''); setExecutorId(''); setError(null)
      qc.invalidateQueries({ queryKey: ['tasks', 'object', id] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const removeTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'object', id] }),
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">← Объекты</Link>
        <h1 className="font-bold text-xl mt-1">{obj?.name ?? '…'}</h1>
        <div className="text-sm text-slate-500">{obj?.address}</div>
      </div>

      {isManager && (
        <form
          className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
          onSubmit={e => { e.preventDefault(); if (title) createTask.mutate() }}
        >
          <div className="font-medium text-sm">Новая задача</div>
          <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Название задачи" value={title}
            onChange={e => setTitle(e.target.value)} required />
          <textarea className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="Описание" rows={2} value={description}
            onChange={e => setDescription(e.target.value)} />
          <div className="flex gap-3">
            <select className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              value={executorId} onChange={e => setExecutorId(e.target.value)}>
              <option value="">Исполнитель не назначен</option>
              {executors?.map(p => <option key={p.id} value={p.id}>{p.email}</option>)}
            </select>
            <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              disabled={createTask.isPending}>
              Создать
            </button>
          </div>
        </form>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}

      <ul className="space-y-2">
        {tasks?.map(t => (
          <li key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
            <Link to={`/task/${t.id}`} className="flex-1 min-w-0 hover:underline">
              <div className="font-medium truncate">{t.title}</div>
              <div className="text-xs text-slate-500">
                {t.executor ? t.executor.email : 'исполнитель не назначен'}
              </div>
            </Link>
            <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[t.status]}`}>
              {LBL[t.status as TaskStatus]}
            </span>
            {isManager && (
              <button className="text-xs text-slate-400 hover:text-red-600"
                onClick={() => { if (confirm('Удалить задачу?')) removeTask.mutate(t.id) }}>
                Удалить
              </button>
            )}
          </li>
        ))}
        {tasks?.length === 0 && <li className="text-slate-400 text-sm">Задач нет.</li>}
      </ul>
    </div>
  )
}
