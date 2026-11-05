-- ============================================================
-- 003_rls_fix.sql — устранение рекурсии RLS-политик.
--
-- Проблема: политики вида
--   exists (select 1 from profiles where role = 'manager')
-- читают таблицу profiles, на которой включён RLS, — его политики
-- снова читают profiles и т.д. Postgres останавливает это ошибкой
-- «infinite recursion detected in policy».
--
-- Решение (стандартное для Supabase): роль текущего пользователя
-- возвращает SECURITY DEFINER-функция — она выполняется от владельца
-- и RLS на неё не действует.
-- Перезапускаемый. Выполнять после 001.
-- ============================================================

-- ---------- функция роли ----------
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on function public.my_role() from anon, public;
grant execute on function public.my_role() to authenticated;

-- ---------- profiles ----------
drop policy if exists "profiles_select_for_managers" on public.profiles;
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all"
  on public.profiles for select
  using (auth.uid() = id or public.my_role() = 'manager');

-- ---------- objects ----------
drop policy if exists "objects_all_for_managers" on public.objects;
create policy "objects_all_for_managers"
  on public.objects for all
  using (public.my_role() = 'manager')
  with check (public.my_role() = 'manager');

drop policy if exists "objects_select_for_executors" on public.objects;
create policy "objects_select_for_executors"
  on public.objects for select
  using (
    public.my_role() = 'executor'
    and exists (
      select 1 from public.tasks t
      where t.object_id = objects.id and t.executor_id = auth.uid()
    )
  );

-- ---------- tasks ----------
drop policy if exists "tasks_all_for_managers" on public.tasks;
create policy "tasks_all_for_managers"
  on public.tasks for all
  using (public.my_role() = 'manager')
  with check (public.my_role() = 'manager');

drop policy if exists "tasks_select_own_for_executors" on public.tasks;
create policy "tasks_select_own_for_executors"
  on public.tasks for select
  using (public.my_role() = 'executor' and executor_id = auth.uid());

-- ---------- task_history ----------
drop policy if exists "history_select_for_managers" on public.task_history;
create policy "history_select_for_managers"
  on public.task_history for select
  using (public.my_role() = 'manager');

-- ---------- страж: роль через my_role() (триггер выполняется
-- от вызывающего, прямой select из profiles задевал бы RLS) ----------
create or replace function public.guard_task_update()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  v_role := public.my_role();

  -- NB: coalesce обязателен: current_setting(..., true) вернёт NULL,
  -- если настройка не ставилась, а «NULL <> 'on'» даёт NULL — и
  -- условие молча не срабатывает (поймано тестом атаки).

  -- смена статуса напрямую запрещена ВСЕМ, кроме функции перехода
  if new.status is distinct from old.status
     and coalesce(current_setting('app.bypass_guard', true), '') <> 'on' then
    raise exception
      'Прямое изменение статуса запрещено — используйте app_transition_task()';
  end if;

  -- исполнителя можно переназначить только менеджеру и только у новой задачи
  if new.executor_id is distinct from old.executor_id
     and coalesce(current_setting('app.bypass_guard', true), '') <> 'on' then
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

-- ---------- функция перехода: роль тоже через my_role() ----------
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
  v_role := public.my_role();
  if v_role is null then
    raise exception 'У пользователя не задана роль';
  end if;

  select * into v_task from public.tasks where id = p_task for update;
  if not found then
    raise exception 'Задача не найдена';
  end if;

  if v_role = 'executor' and v_task.executor_id is distinct from auth.uid() then
    raise exception 'Это не ваша задача';
  end if;

  v_from := v_task.status;

  if v_from = 'new' and p_to = 'in_progress' then
    if v_role <> 'executor' or v_task.executor_id is distinct from auth.uid() then
      raise exception 'Взять в работу может только назначенный исполнитель';
    end if;

  elsif v_from = 'in_progress' and p_to = 'review' then
    if v_role <> 'executor' or v_task.executor_id is distinct from auth.uid() then
      raise exception 'Отправить на проверку может только исполнитель задачи';
    end if;

  elsif v_from = 'review' and p_to = 'done' then
    if v_role <> 'manager' then
      raise exception 'Принять задачу может только постановщик';
    end if;

  elsif v_from = 'review' and p_to = 'rework' then
    if v_role <> 'manager' then
      raise exception 'Вернуть на доработку может только постановщик';
    end if;
    if p_comment is null or btrim(p_comment) = '' then
      raise exception 'При возврате на доработку комментарий обязателен';
    end if;

  elsif v_from = 'rework' and p_to = 'in_progress' then
    if v_role <> 'executor' or v_task.executor_id is distinct from auth.uid() then
      raise exception 'Взять в работу может только назначенный исполнитель';
    end if;

  else
    raise exception 'Переход % -> % запрещён', v_from, p_to;
  end if;

  if p_to not in ('new','in_progress','review','rework','done') then
    raise exception 'Неизвестный статус %', p_to;
  end if;

  perform set_config('app.bypass_guard', 'on', true);
  update public.tasks set status = p_to where id = p_task
    returning * into v_task;

  insert into public.task_history (task_id, actor_id, from_status, to_status, comment)
  values (p_task, auth.uid(), v_from, p_to, nullif(btrim(p_comment), ''));

  return v_task;
end;
$$;

revoke all on function public.app_transition_task(uuid, text, text) from anon, public;
grant execute on function public.app_transition_task(uuid, text, text) to authenticated;
