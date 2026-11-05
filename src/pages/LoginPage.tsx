import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../api/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setError(error.message === 'Invalid login credentials'
        ? 'Неверный email или пароль'
        : error.message)
      return
    }
    nav('/')
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h1 className="font-bold text-xl">Вход в СтройCRM</h1>
        <p className="text-sm text-slate-500">Регистрация закрыта — аккаунты создаёт администратор.</p>
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)} required
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          type="password" placeholder="Пароль" value={password}
          onChange={e => setPassword(e.target.value)} required
        />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          className="w-full bg-slate-900 text-white rounded-lg py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
          disabled={busy}
        >
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
