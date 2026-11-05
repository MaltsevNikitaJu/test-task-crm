import { createClient } from '@supabase/supabase-js'

// Только publishable (anon) ключ: он публичный по задумке Supabase и
// безопасен во фронте. service_role в коде не используется нигде —
// все привилегированные операции выполняет база (RLS + security definer).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)
