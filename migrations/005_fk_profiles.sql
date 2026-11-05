-- ============================================================
-- 005_fk_profiles.sql — внешние ключи на public.profiles.
--
-- Задача: поля executor_id/author_id ссылались на auth.users —
-- PostgREST не может встраивать данные из схемы auth (не exposen),
-- поэтому карточка задачи не получала имя исполнителя.
-- Перевешиваем FK на public.profiles (id профилей = id пользователей
-- auth.users, данные не меняются). Перезапускаемый.
-- ============================================================

alter table public.tasks
  drop constraint if exists tasks_executor_id_fkey;
alter table public.tasks
  add constraint tasks_executor_id_fkey
  foreign key (executor_id) references public.profiles(id);

alter table public.tasks
  drop constraint if exists tasks_author_id_fkey;
alter table public.tasks
  add constraint tasks_author_id_fkey
  foreign key (author_id) references public.profiles(id);

alter table public.task_history
  drop constraint if exists task_history_actor_id_fkey;
alter table public.task_history
  add constraint task_history_actor_id_fkey
  foreign key (actor_id) references public.profiles(id);
