-- ============================================================
-- 001_schema.sql — мини-CRM «Объекты и задачи»
-- Таблицы, роли, RLS, функция переходов статусов, защита истории.
-- Выполнять в SQL Editor Supabase целиком. Скрипт перезапускаемый:
-- повторный запуск безопасен (if not exists / drop policy if exists).
-- ============================================================

-- ================= 1. ТАБЛИЦЫ (все, без политик) =================

create table if not exists public.profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role  text not null check (role in ('manager', 'executor'))
);

create table if not exists public.objects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null default '',
  object_id   uuid not null references public.objects(id) on delete cascade,
  executor_id uuid references auth.users(id),          -- может быть пустым до назначения
  status      text not null default 'new'
              check (status in ('new','in_progress','review','rework','done')),
  author_id   uuid not null references auth.users(id), -- постановщик
  created_at  timestamptz not null default now()
);
create index if not exists tasks_executor_idx on public.tasks(executor_id);
create index if not exists tasks_object_idx on public.tasks(object_id);

create table if not exists public.task_history (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  actor_id    uuid not null references auth.users(id),
  from_status text not null,
  to_status   text not null,
  comment     text,
  created_at  timestamptz not null default now()
);
create index if not exists history_task_idx on public.task_history(task_id);

-- ================= 2. RLS И ПОЛИТИКИ =================

alter table public.profiles     enable row level security;
alter table public.objects      enable row level security;
alter table public.tasks        enable row level security;
alter table public.task_history enable row level security;

-- ---------- profiles ----------
-- своё поле профиля видят все авторизованные
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
  on public.profiles for select
  using (auth.uid() = id);

-- менеджеры видят всех (чтобы назначать исполнителей)
drop policy if exists "profiles_select_for_managers" on public.profiles;
create policy "profiles_select_for_managers"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );
-- намеренно НЕТ политик insert/update/delete:
-- роли меняются только из SQL Editor (как владелец), через API нельзя

-- ---------- objects ----------
-- менеджеры: полный доступ
drop policy if exists "objects_all_for_managers" on public.objects;
create policy "objects_all_for_managers"
  on public.objects for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );

-- исполнители: читают только объекты, где у них есть задачи
drop policy if exists "objects_select_for_executors" on public.objects;
create policy "objects_select_for_executors"
  on public.objects for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'executor'
    )
    and exists (
      select 1 from public.tasks t
      where t.object_id = objects.id and t.executor_id = auth.uid()
    )
  );

-- ---------- tasks ----------
-- менеджеры: всё
drop policy if exists "tasks_all_for_managers" on public.tasks;
create policy "tasks_all_for_managers"
  on public.tasks for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );

-- исполнители: читают только свои
drop policy if exists "tasks_select_own_for_executors" on public.tasks;
create policy "tasks_select_own_for_executors"
  on public.tasks for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'executor'
    )
    and executor_id = auth.uid()
  );

-- ---------- task_history ----------
-- читать: менеджерам всё
drop policy if exists "history_select_for_managers" on public.task_history;
create policy "history_select_for_managers"
  on public.task_history for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'manager'
    )
  );
-- читать: исполнителям — истории своих задач
drop policy if exists "history_select_for_own_tasks" on public.task_history;
create policy "history_select_for_own_tasks"
  on public.task_history for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_history.task_id and t.executor_id = auth.uid()
    )
  );
-- НЕТ политик insert/update/delete: через API историю нельзя
-- ни создать, ни изменить, ни удалить. Пишет только функция
-- app_transition_task (security definer, владелец обходит RLS).

-- ================= 3. ФУНКЦИИ И ТРИГГЕРЫ =================

-- ---------- Страж прямых изменений задач ----------
-- Любая попытка напрямую (в обход функции) поменять статус
-- или исполнителя задачи -> исключение на уровне базы.
create or replace function public.guard_task_update()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  select role into v_role from public.profiles where id = auth.uid();

  -- смена статуса напрямую запрещена ВСЕМ, кроме функции перехода
  if new.status is distinct from old.status
     and current_setting('app.bypass_guard', true) <> 'on' then
    raise exception
      'Прямое изменение статуса запрещено — используйте app_transition_task()';
  end if;

  -- исполнителя можно переназначить только менеджеру и только у новой задачи
  if new.executor_id is distinct from old.executor_id
     and current_setting('app.bypass_guard', true) <> 'on' then
    if v_role <> 'manager' then
      raise exception 'Переназначать исполнителя может только постановщик';
    end if;
    if old.status <> 'new' then
      raise exception 'Исполнителя можно менять только у задачи в статусе new';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_guard on public.tasks;
create trigger tasks_guard
  before update on public.tasks
  for each row execute function public.guard_task_update();

-- ---------- Функция перехода статусов ----------
-- ЕДИНСТВЕННАЯ легальная точка смены статуса. Проверяет роль,
-- исполнителя и допустимость перехода. Пишет историю.
create or replace function public.app_transition_task(
  p_task    uuid,
  p_to      text,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks;
  v_role text;
  v_from text;
begin
  -- роль текущего пользователя
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    raise exception 'У пользователя не задана роль';
  end if;

  select * into v_task from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Задача не найдена';
  end if;

  -- исполнитель видит только свои задачи: чужую не найдёт и здесь
  if v_role = 'executor' and v_task.executor_id is distinct from auth.uid() then
    raise exception 'Это не ваша задача';
  end if;

  v_from := v_task.status;

  if v_from = 'new' and p_to = 'in_progress' then
    -- берёт в работу назначенный исполнитель
    if v_role <> 'executor' or v_task.executor_id is distinct from auth.uid() then
      raise exception 'Взять в работу может только назначенный исполнитель';
    end if;

  elsif v_from = 'in_progress' and p_to = 'review' then
    -- на проверку отправляет назначенный исполнитель
    if v_role <> 'executor' or v_task.executor_id is distinct from auth.uid() then
      raise exception 'Отправить на проверку может только исполнитель задачи';
    end if;

  elsif v_from = 'review' and p_to = 'done' then
    -- принимает постановщик
    if v_role <> 'manager' then
      raise exception 'Принять задачу может только постановщик';
    end if;

  elsif v_from = 'review' and p_to = 'rework' then
    -- возвращает постановщик, комментарий обязателен
    if v_role <> 'manager' then
      raise exception 'Вернуть на доработку может только постановщик';
    end if;
    if p_comment is null or btrim(p_comment) = '' then
      raise exception 'При возврате на доработку комментарий обязателен';
    end if;

  elsif v_from = 'rework' and p_to = 'in_progress' then
    -- снова в работу берёт назначенный исполнитель
    if v_role <> 'executor' or v_task.executor_id is distinct from auth.uid() then
      raise exception 'Взять в работу может только назначенный исполнитель';
    end if;

  else
    raise exception 'Переход % -> % запрещён', v_from, p_to;
  end if;

  if p_to not in ('new','in_progress','review','rework','done') then
    raise exception 'Неизвестный статус %', p_to;
  end if;

  -- легальная смена: поднимаем флаг для триггера (только эта транзакция)
  perform set_config('app.bypass_guard', 'on', true);
  update public.tasks set status = p_to where id = p_task
    returning * into v_task;

  insert into public.task_history (task_id, actor_id, from_status, to_status, comment)
  values (p_task, auth.uid(), v_from, p_to, nullif(btrim(p_comment), ''));

  return v_task;
end;
$$;

-- выполнять функцию могут только авторизованные (не anon)
revoke all on function public.app_transition_task(uuid, text, text) from anon, public;
grant execute on function public.app_transition_task(uuid, text, text) to authenticated;
