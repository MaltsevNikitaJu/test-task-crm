# Мини-CRM «Объекты и задачи»

Тестовое задание: CRM для строительной компании. Руководитель (постановщик)
ставит задачи по объектам-стройкам, исполнители выполняют и сдают на проверку.

**Стек:** React 18 + TypeScript (Vite), Supabase (Postgres + Auth + RLS),
TanStack Query, Tailwind CSS, React Router.

## Как устроено (коротко)

- **Роли** лежат в таблице `profiles` (`manager` / `executor`), связанной с `auth.users`.
- **Статусы задач** (`new → in_progress → review → done`, `review → rework → in_progress`)
  меняются **только** через функцию БД `app_transition_task(task, to, comment)`:
  она проверяет роль, исполнителя и допустимость перехода, пишет историю.
- **Триггер `guard_task_update`** запрещает менять статус/исполнителя
  напрямую через UPDATE — даже авторизованному постановщику.
- **RLS-политики**: исполнитель читает только свои задачи и только свои объекты;
  постановщик видит всё. Роль в политиках — через `my_role()` (security definer,
  без рекурсии). У `task_history` **нет** политик на запись — историю нельзя
  создать, изменить или удалить через API в принципе; её пишет только
  `app_transition_task`.
- **Регистрация закрыта**; тестовые пользователи создаются в Supabase вручную.
- Во фронтенде только publishable (anon) ключ. `service_role` не используется
  нигде и в репозиторий не попадает.

## Запуск проекта

1. Создать проект в [supabase.com](https://supabase.com) (бесплатный тариф).
2. SQL Editor → выполнить миграции по порядку:
   `001_schema.sql` → (создать пользователей, см. шаг 3) → `002_seed.sql`.
   Дальше по порядку: `003_rls_fix.sql`, `004_reseed.sql`, `005_fk_profiles.sql`
   (003 и 005 — исправления, найденные тестами; 004 — чистая перезаливка демо-данных).
3. Authentication → Users → Add user → Create three users (email + пароль,
   «Auto Confirm» включить):
   - `boss@test.local` — постановщик
   - `worker1@test.local`, `worker2@test.local` — исполнители
4. Authentication → Providers → Email → выключить «Allow new users to sign up».
5. `.env.example` скопировать в `.env`, вписать свой URL и ключ
   (Settings → API → Project URL и publishable/anon key).
6. `npm install && npm run dev` — приложение на http://localhost:5173.

Сборка: `npm run build` (результат в `dist/`).

## Тестовые доступы (демо)

| Роль | Email | Пароль |
|------|-------|--------|
| Постановщик | boss@test.local | boss@test.local |
| Исполнитель | worker1@test.local | worker1@test.local |
| Исполнитель | worker2@test.local | worker2@test.local |

## Тесты

- `node test-security.mjs` — набор атак в обход интерфейса: изоляция
  исполнителя (задачи/объекты/история), прямые UPDATE статусов, подделка
  истории, запрещённые переходы, полный рабочий цикл. 19 проверок.
- `python test_ui.py` — UI-смоук (нужен запущенный `npm run dev`):
  экраны постановщика и исполнителя, изоляция в интерфейсе.

## Миграции

| Файл | Что делает |
|------|------------|
| `001_schema.sql` | таблицы, RLS, функция переходов, триггер-страж |
| `002_seed.sql` | роли демо-пользователей + демо-данные |
| `003_rls_fix.sql` | фикс рекурсии RLS (роль через security definer `my_role()`), NULL-ловушка в страже |
| `004_reseed.sql` | чистая перезаливка демо-данных |
| `005_fk_profiles.sql` | FK на `public.profiles` для встраивания имён в PostgREST |
