-- ============================================================
-- 002_seed.sql — роли тестовых пользователей + демо-данные.
-- Запускать ПОСЛЕ того, как в Authentication созданы пользователи:
--   boss@test.local   (постановщик)
--   worker1@test.local (исполнитель)
--   worker2@test.local (исполнитель)
-- Пароли задаются при создании, сюда не входят.
-- ============================================================

-- ---------- роли ----------
insert into public.profiles (id, email, role)
select u.id, u.email, 'manager'
from auth.users u where u.email = 'boss@test.local'
on conflict (id) do update set role = 'manager';

insert into public.profiles (id, email, role)
select u.id, u.email, 'executor'
from auth.users u where u.email in ('worker1@test.local', 'worker2@test.local')
on conflict (id) do update set role = 'executor';

-- ---------- объекты ----------
insert into public.objects (id, name, address) values
  ('11111111-1111-1111-1111-111111111111', 'ЖК «Северный», корпус 3', 'г. Тюмень, ул. Республики 111'),
  ('22222222-2222-2222-2222-222222222222', 'ТЦ «Меркурий» — фасад', 'г. Тюмень, ул. Мельникайте 222'),
  ('33333333-3333-3333-3333-333333333333', 'Школа №42 — капитальный ремонт', 'г. Тюмень, ул. Пермякова 333')
on conflict (id) do nothing;

-- ---------- задачи в разных статусах ----------
insert into public.tasks (title, description, object_id, executor_id, status, author_id, created_at) values
  ('Монтаж каркаса 4-го этажа',
   'Собрать металлокаркас согласно проекту КЖ-14.',
   '11111111-1111-1111-1111-111111111111',
   (select id from auth.users where email = 'worker1@test.local'),
   'in_progress',
   (select id from auth.users where email = 'boss@test.local'),
   now() - interval '3 days'),

  ('Кладка перегородок, 2 этаж',
   'Кирпичные перегородки по осям А-В.',
   '11111111-1111-1111-1111-111111111111',
   (select id from auth.users where email = 'worker2@test.local'),
   'review',
   (select id from auth.users where email = 'boss@test.local'),
   now() - interval '5 days'),

  ('Гидроизоляция фундамента',
   'Обмазочная гидроизоляция, 2 слоя.',
   '11111111-1111-1111-1111-111111111111',
   (select id from auth.users where email = 'worker1@test.local'),
   'new',
   (select id from auth.users where email = 'boss@test.local'),
   now() - interval '1 day'),

  ('Монтаж вентфасада, северная сторона',
   'Подконструкция + керамогранит 600х600.',
   '22222222-2222-2222-2222-222222222222',
   (select id from auth.users where email = 'worker2@test.local'),
   'rework',
   (select id from auth.users where email = 'boss@test.local'),
   now() - interval '7 days'),

  ('Замена электрощитовой',
   'Щит ВРУ-1, проект ЭОМ.',
   '22222222-2222-2222-2222-222222222222',
   null,
   'new',
   (select id from auth.users where email = 'boss@test.local'),
   now()),

  ('Демонтаж старых окон',
   '120 оконных блоков, вынос мусора.',
   '33333333-3333-3333-3333-333333333333',
   (select id from auth.users where email = 'worker1@test.local'),
   'done',
   (select id from auth.users where email = 'boss@test.local'),
   now() - interval '10 days'),

  ('Штукатурка стен, 1 этаж',
   'Гипсовая штукатурка по маякам.',
   '33333333-3333-3333-3333-333333333333',
   (select id from auth.users where email = 'worker2@test.local'),
   'new',
   (select id from auth.users where email = 'boss@test.local'),
   now() - interval '2 days')
on conflict do nothing;

-- ---------- история под задачи (правдоподобные цепочки) ----------
insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'boss@test.local'),
       'new', 'in_progress', null, t.created_at + interval '2 hours'
from public.tasks t where t.title = 'Монтаж каркаса 4-го этажа';

insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'worker2@test.local'),
       'in_progress', 'review', null, t.created_at + interval '2 days'
from public.tasks t where t.title = 'Кладка перегородок, 2 этаж';

insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'boss@test.local'),
       'in_progress', 'review', null, t.created_at + interval '3 days'
from public.tasks t where t.title = 'Монтаж вентфасада, северная сторона';

insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'boss@test.local'),
       'review', 'rework', 'Крепления керамогранита не по проекту — переделать узлы КВ-3.', t.created_at + interval '4 days'
from public.tasks t where t.title = 'Монтаж вентфасада, северная сторона';

insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'worker1@test.local'),
       'new', 'in_progress', null, t.created_at + interval '1 day'
from public.tasks t where t.title = 'Демонтаж старых окон';

insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'worker1@test.local'),
       'in_progress', 'review', null, t.created_at + interval '3 days'
from public.tasks t where t.title = 'Демонтаж старых окон';

insert into public.task_history (task_id, actor_id, from_status, to_status, comment, created_at)
select t.id,
       (select id from auth.users where email = 'boss@test.local'),
       'review', 'done', 'Принято, окна вывезены.', t.created_at + interval '4 days'
from public.tasks t where t.title = 'Демонтаж старых окон';
