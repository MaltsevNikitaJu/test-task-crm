import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../api/supabase'
import type { BuildObject } from '../api/types'

export default function ObjectsPage() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: objects, isLoading } = useQuery({
    queryKey: ['objects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('objects').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as BuildObject[]
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('objects').insert({ name, address })
      if (error) throw error
    },
    onSuccess: () => {
      setName(''); setAddress(''); setError(null)
      qc.invalidateQueries({ queryKey: ['objects'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('objects').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objects'] }),
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="space-y-6">
      <h1 className="font-bold text-xl">Объекты</h1>

      <form
        className="bg-white border border-slate-200 rounded-xl p-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={e => { e.preventDefault(); if (name && address) create.mutate() }}
      >
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Название (ЖК «Северный»)" value={name}
          onChange={e => setName(e.target.value)} required />
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Адрес" value={address}
          onChange={e => setAddress(e.target.value)} required />
        <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          disabled={create.isPending}>
          Добавить объект
        </button>
      </form>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {isLoading ? (
        <div className="text-slate-400 text-sm">Загрузка…</div>
      ) : (
        <ul className="space-y-2">
          {objects?.map(o => (
            <li key={o.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <Link to={`/object/${o.id}`} className="flex-1 hover:underline">
                <div className="font-medium">{o.name}</div>
                <div className="text-sm text-slate-500">{o.address}</div>
              </Link>
              <button
                className="text-xs text-slate-400 hover:text-red-600"
                onClick={() => { if (confirm(`Удалить объект «${o.name}» вместе с его задачами?`)) remove.mutate(o.id) }}
              >
                Удалить
              </button>
            </li>
          ))}
          {objects?.length === 0 && <li className="text-slate-400 text-sm">Объектов пока нет.</li>}
        </ul>
      )}
    </div>
  )
}
