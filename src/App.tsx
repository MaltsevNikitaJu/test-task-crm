import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'
import ObjectsPage from './pages/ObjectsPage'
import ObjectCardPage from './pages/ObjectCardPage'
import TaskCardPage from './pages/TaskCardPage'
import MyTasksPage from './pages/MyTasksPage'

function Shell({ children }: { children: React.ReactNode }) {
  const { profile, signOut } = useAuth()
  const nav = useNavigate()
  const isManager = profile?.role === 'manager'
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link to={isManager ? '/' : '/my'} className="font-bold text-lg">
            СтройCRM
          </Link>
          <nav className="flex gap-3 text-sm">
            {isManager && <Link to="/" className="text-slate-600 hover:text-slate-900">Объекты</Link>}
            <Link to="/my" className="text-slate-600 hover:text-slate-900">Мои задачи</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{profile?.email}</span>
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">
              {profile?.role === 'manager' ? 'Постановщик' : 'Исполнитель'}
            </span>
            <button
              className="text-slate-400 hover:text-slate-700"
              onClick={() => { signOut().then(() => nav('/login')) }}
            >
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}

export default function App() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-400">Загрузка…</div>
  }
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  if (!profile) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-400">
        Ждём профиль пользователя… (роль задаётся в базе)
      </div>
    )
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={profile.role === 'manager' ? <ObjectsPage /> : <Navigate to="/my" replace />} />
        <Route path="/object/:id" element={<ObjectCardPage />} />
        <Route path="/task/:id" element={<TaskCardPage />} />
        <Route path="/my" element={<MyTasksPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}
