// Проверка безопасности: атаки напрямую через API, в обход интерфейса.
// Запуск: node test-security.mjs  (из папки проекта)
import { createClient } from '@supabase/supabase-js'

const URL = process.env.VITE_SUPABASE_URL ||
  (await import('node:fs')).readFileSync('.env', 'utf8').match(/VITE_SUPABASE_URL=(.+)/)[1].trim()
const KEY = process.env.VITE_SUPABASE_ANON_KEY ||
  (await import('node:fs')).readFileSync('.env', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()

const mk = () => createClient(URL, KEY)
const results = []
const check = (name, cond, extra = '') =>
  results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)

async function main() {
  // ---------- вход ----------
  const boss = mk()
  const w1 = mk()
  const w2 = mk()
  const rB = await boss.auth.signInWithPassword({ email: 'boss@test.local', password: 'boss@test.local' })
  const r1 = await w1.auth.signInWithPassword({ email: 'worker1@test.local', password: 'worker1@test.local' })
  const r2 = await w2.auth.signInWithPassword({ email: 'worker2@test.local', password: 'worker2@test.local' })
  const uidB = rB.data.session?.user?.id
  const uid1 = r1.data.session?.user?.id
  const uid2 = r2.data.session?.user?.id
  check('вход: три тестовых пользователя', !rB.error && !r1.error && !r2.error && uidB && uid1 && uid2,
    [rB.error, r1.error, r2.error].map(e => e?.message).filter(Boolean).join('; '))

  // ---------- роли ----------
  const { data: pB } = await boss.from('profiles').select('role').eq('id', uidB).single()
  const { data: p1 } = await w1.from('profiles').select('role').eq('id', uid1).single()
  check('роли: boss=manager, worker1=executor', pB?.role === 'manager' && p1?.role === 'executor',
    `boss=${pB?.role} w1=${p1?.role}`)

  // ---------- данные сида ----------
  const { data: objsB } = await boss.from('objects').select()
  check('boss видит все 3 объекта', objsB?.length === 3, `видит ${objsB?.length}`)

  const { data: tasksB } = await boss.from('tasks').select()
  check('boss видит все задачи', (tasksB?.length ?? 0) >= 7, `видит ${tasksB?.length}`)

  // ---------- АТАКА 1: исполнитель читает чужое ----------
  const { data: tasks1 } = await w1.from('tasks').select()
  const foreign = (tasks1 ?? []).filter(t => t.executor_id && t.executor_id !== uid1)
  check('RLS: worker1 видит ТОЛЬКО свои задачи', (tasks1?.length ?? 0) > 0 && foreign.length === 0,
    `видит ${tasks1?.length}, чужих ${foreign.length}`)

  const { data: objs1 } = await w1.from('objects').select()
  const { data: tasks1ObjIds } = await w1.from('tasks').select('object_id')
  const myObjIds = new Set((tasks1ObjIds ?? []).map(t => t.object_id))
  check('RLS: worker1 видит только объекты со своими задачами',
    (objs1 ?? []).every(o => myObjIds.has(o.id)) && (objs1?.length ?? 0) > 0,
    `видит объектов: ${objs1?.length}`)

  const { data: hist1 } = await w1.from('task_history').select()
  const taskIds1 = new Set((tasks1 ?? []).map(t => t.id))
  check('RLS: история только своих задач', (hist1 ?? []).every(h => taskIds1.has(h.task_id)), `строк ${hist1?.length}`)

  // ---------- АТАКА 2: прямое изменение статуса ----------
  const myTask1 = (tasks1 ?? []).find(t => t.status === 'new' || t.status === 'in_progress')
  let err = null
  if (myTask1) {
    const r = await w1.from('tasks').update({ status: 'done' }).eq('id', myTask1.id)
    err = r.error
    // RLS может молча отдать 0 строк без ошибки — проверяем фактическое состояние
    const after = (await w1.from('tasks').select('status').eq('id', myTask1.id).single()).data
    check('СТРАЖ: прямой update статуса не срабатывает (исполнитель)',
      !!err || after?.status === 'in_progress',
      err?.message ?? (after?.status === 'in_progress' ? 'RLS отсёк строку — статус не изменился' : 'ПРОШЁЛ — статус сменился!'))
  } else {
    check('СТРАЖ: прямой update статуса не срабатывает (исполнитель)', false, 'нет задачи in_progress для теста')
  }

  const someTask = tasksB?.find(t => t.status === 'in_progress')
  const rMgr = await boss.from('tasks').update({ status: 'done' }).eq('id', someTask.id)
  const afterMgr = (await boss.from('tasks').select('status').eq('id', someTask.id).single()).data
  check('СТРАЖ: прямой update статуса отклонён (даже постановщик)',
    !!rMgr.error || afterMgr?.status === 'in_progress',
    rMgr.error?.message ?? (afterMgr?.status === 'in_progress' ? 'отклонено (статус не изменился)' : 'ПРОШЁЛ — статус сменился!'))

  // ---------- АТАКА 3: подделка истории ----------
  const rh = await boss.from('task_history').insert({ task_id: someTask.id, actor_id: uidB, from_status: 'new', to_status: 'done', comment: 'подделка' })
  check('ИСТОРИЯ: insert отклонён', !!rh.error, rh.error?.message ?? 'прошёл!')
  if (hist1?.length) {
    const h0 = hist1[0]
    await boss.from('task_history').update({ comment: 'взлом' }).eq('id', h0.id)
    await boss.from('task_history').delete().eq('id', h0.id)
    const re = (await boss.from('task_history').select('comment').eq('id', h0.id).maybeSingle()).data
    check('ИСТОРИЯ: update/delete не срабатывают',
      re !== null && re.comment === h0.comment,
      re === null ? 'СТРОКА ИСЧЕЗЛА — delete прошёл!' : (re.comment !== h0.comment ? 'КОММЕНТАРИЙ ИЗМЕНЁН!' : 'строка нетронута'))
  }

  // ---------- АТАКА 4: запрещённые переходы ----------
  const newTask = tasksB?.find(t => t.status === 'new')
  if (newTask) {
    const r = await boss.rpc('app_transition_task', { p_task: newTask.id, p_to: 'done', p_comment: null })
    check('ПЕРЕХОД: new→done отклонён (даже постановщик)', !!r.error, r.error?.message ?? 'прошёл!')
    const r2b = await w1.rpc('app_transition_task', { p_task: newTask.id, p_to: 'in_progress', p_comment: null })
    const isOwn = newTask.executor_id === uid1
    check('ПЕРЕХОД: new→in_progress только назначенный исполнитель',
      isOwn ? !r2b.error : !!r2b.error, r2b.error?.message ?? (isOwn ? 'прошёл (своё — ок)' : 'прошёл!'))
  }

  // чужая задача
  const w2Task = (await w2.from('tasks').select().eq('status', 'in_progress').maybeSingle())
  if (w2Task) {
    const r = await w1.rpc('app_transition_task', { p_task: w2Task.id, p_to: 'review', p_comment: null })
    check('ПЕРЕХОД: чужую задачу сдвинуть нельзя', !!r.error, r.error?.message ?? 'прошёл!')
  }

  // rework без комментария
  const reviewTask = tasksB?.find(t => t.status === 'review')
  if (reviewTask) {
    const r = await boss.rpc('app_transition_task', { p_task: reviewTask.id, p_to: 'rework', p_comment: null })
    check('ПЕРЕХОД: rework без комментария отклонён', !!r.error, r.error?.message ?? 'прошёл!')
    const r2c = await boss.rpc('app_transition_task', { p_task: reviewTask.id, p_to: 'rework', p_comment: 'Переделать узлы' })
    check('ПЕРЕХОД: rework с комментарием проходит', !r2c.error, r2c.error?.message ?? 'ok')
    // и обратно в работу исполнителем
    const execOfReview = reviewTask.executor_id === uid1 ? w1 : w2
    const r3 = await execOfReview.rpc('app_transition_task', { p_task: reviewTask.id, p_to: 'in_progress', p_comment: null })
    check('ПЕРЕХОД: rework→in_progress исполнителем проходит', !r3.error, r3.error?.message ?? 'ok')
  }

  // ---------- легальный полный цикл ----------
  const cycObj = (await boss.from('objects').insert({ name: 'Тест цикла', address: 'тест' }).select().single()).data
  const exec1Id = uid1
  const cycTask = (await boss.from('tasks').insert({
    title: 'Задача полного цикла', description: 'тест', object_id: cycObj.id,
    executor_id: exec1Id, author_id: uidB,
  }).select().single()).data
  const s1 = await w1.rpc('app_transition_task', { p_task: cycTask.id, p_to: 'in_progress' })
  const s2 = await w1.rpc('app_transition_task', { p_task: cycTask.id, p_to: 'review' })
  const s3 = await boss.rpc('app_transition_task', { p_task: cycTask.id, p_to: 'done' })
  check('ЦИКЛ: new→in_progress→review→done проходит по ролям', !s1.error && !s2.error && !s3.error,
    [s1.error?.message, s2.error?.message, s3.error?.message].filter(Boolean).join('; ') || 'ok')
  const { data: cycHist } = await boss.from('task_history').select().eq('task_id', cycTask.id)
  check('ЦИКЛ: история записалась (3 записи)', cycHist?.length === 3, `записей ${cycHist?.length}`)
  // уборка тестовых данных
  await boss.from('objects').delete().eq('id', cycObj.id)

  // ---------- итог ----------
  console.log('\n===== РЕЗУЛЬТАТЫ =====')
  results.forEach(r => console.log(r))
  const failed = results.filter(r => r.startsWith('❌')).length
  console.log(`\n${failed === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : 'ПРОВАЛОВ: ' + failed}`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(e => { console.error(e.stack || e.message); process.exit(2) })
