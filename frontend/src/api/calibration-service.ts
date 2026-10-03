import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 这卷台账的模块 key，与 modules.ts、seed.ts 里登记的一致。
export const CALIBRATION_KEY = 'calibration'

// 校准周期允许区间（月）：超出即「超限」，登记和算提醒都按这个挡。
export const CYCLE_MIN_MONTHS = 1
export const CYCLE_MAX_MONTHS = 36

// 计量确认结论的可选值：结论只能由计量组出具，页面按这份列表给选项。
export const CONFIRM_RESULTS = ['符合', '不符合']

// 状态一节一节往前走：待送检 → 已送检 → 已校准 → 已确认，跨级的一律拒收。
const FLOW = ['待送检', '已送检', '已校准', '已确认']
const ACTION_STEPS: Record<string, { from: string; to: string }> = {
  登记送检: { from: '待送检', to: '已送检' },
  登记校准结果: { from: '已送检', to: '已校准' },
  出具计量确认: { from: '已校准', to: '已确认' },
}

export type ReminderItem = {
  id: number
  仪器编号: string
  仪器名称: string
  检测线: string
  校准周期月: number
  上次校准日期: string
  到期日期: string
  剩余天数: number
  逾期: boolean
  计量确认结论: string
  status: string
}

export type RejectedReminder = {
  id: number
  仪器编号: string
  reason: string
}

export type ReminderBoard = {
  generatedAt: string
  items: ReminderItem[]
  rejected: RejectedReminder[]
}

export type CreateCalibrationInput = {
  仪器编号: string
  仪器名称: string
  检测线: string
  校准周期月: number
  上次校准日期: string
}

export type AdvancePayload = {
  送检人?: string
  证书编号?: string
  校准日期?: string
  确认结论?: string
}

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// 只认真实存在的 YYYY-MM-DD：2 月 31 日这类写法在这里就挡掉。
function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

// 加整月，月末往回收（1 月 31 日 + 1 个月 = 2 月 28 日），不往后溢。
function addMonths(date: Date, months: number): Date {
  const day = date.getDate()
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(day, lastDay))
  return target
}

function daysBetween(fromIso: string, to: Date): number {
  const from = parseIsoDate(fromIso)
  if (!from) {
    return 0
  }
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

// 周期超限：不在允许区间内的周期一律挡回。
function checkCycle(cycle: number): string | null {
  if (!Number.isInteger(cycle) || cycle < CYCLE_MIN_MONTHS || cycle > CYCLE_MAX_MONTHS) {
    return `校准周期「${cycle}」超出允许区间（${CYCLE_MIN_MONTHS}–${CYCLE_MAX_MONTHS} 个月）`
  }
  return null
}

// 日期越界：格式不对、不是真实日期、或晚于今天，都算越界。
// 历史记录里的老日期（哪怕上世纪的）不算越界，照常保留。
function checkLastDate(value: string, today: string): string | null {
  if (!parseIsoDate(value)) {
    return `上次校准日期「${value}」不是有效的 YYYY-MM-DD 日期`
  }
  if (value > today) {
    return `上次校准日期「${value}」晚于今天，属于越界数据`
  }
  return null
}

// 异常判定：到期日已过还没确认，或计量确认结论是「不符合」。
function computeAbnormal(row: EntryRow, today: string): boolean {
  if (String(row['计量确认结论'] ?? '') === '不符合') {
    return true
  }
  if (String(row.status) === '已确认') {
    return false
  }
  const cycle = Number(row['校准周期(月)'])
  const lastDate = String(row['上次校准日期'] ?? '')
  if (checkCycle(cycle) || checkLastDate(lastDate, today)) {
    return true
  }
  return toIso(addMonths(parseIsoDate(lastDate)!, cycle)) < today
}

// 全平台唯一的到期提醒来源：台账页、运营概览、灭菌验证清单都从这里取，
// 各入口拿到的属同一份。越界或超限的记录不进提醒，单独进 rejected 清单示警。
export function calibrationReminders(referenceDate = todayIso()): ReminderBoard {
  const items: ReminderItem[] = []
  const rejected: RejectedReminder[] = []
  for (const row of listRows(CALIBRATION_KEY)) {
    const 仪器编号 = String(row['仪器编号'] ?? '')
    const cycle = Number(row['校准周期(月)'])
    const lastDate = String(row['上次校准日期'] ?? '')
    const problems = [checkCycle(cycle), checkLastDate(lastDate, referenceDate)].filter(
      (item): item is string => item !== null,
    )
    if (problems.length > 0) {
      rejected.push({ id: Number(row.id), 仪器编号, reason: problems.join('；') })
      continue
    }
    const due = addMonths(parseIsoDate(lastDate)!, cycle)
    const leftDays = daysBetween(referenceDate, due)
    items.push({
      id: Number(row.id),
      仪器编号,
      仪器名称: String(row['仪器名称'] ?? ''),
      检测线: String(row['检测线'] ?? ''),
      校准周期月: cycle,
      上次校准日期: lastDate,
      到期日期: toIso(due),
      剩余天数: leftDays,
      逾期: leftDays < 0,
      计量确认结论: String(row['计量确认结论'] ?? ''),
      status: String(row.status),
    })
  }
  items.sort((a, b) => a.剩余天数 - b.剩余天数)
  return { generatedAt: referenceDate, items, rejected }
}

// 逾期未确认的那几栏：到期日已过、状态还没走到「已确认」的仪器。
export function overdueUnconfirmed(board: ReminderBoard = calibrationReminders()): ReminderItem[] {
  return board.items.filter((item) => item.逾期 && item.status !== '已确认')
}

// 登记仪器台账。仪器编号按原样保留，不做任何格式改写，历史编号照收。
// 同一台仪器已有在途（未确认）送检记录的，重复送检只算一次，直接挡回。
export function createCalibration(input: CreateCalibrationInput): ActionResult & { id?: number } {
  const 仪器编号 = input.仪器编号
  if (仪器编号.trim() === '') {
    return { ok: false, message: '仪器编号不能为空' }
  }
  if (input.仪器名称.trim() === '' || input.检测线.trim() === '') {
    return { ok: false, message: '仪器名称和检测线都不能空，台账要按检测线分组' }
  }
  const today = todayIso()
  const cycleError = checkCycle(input.校准周期月)
  if (cycleError) {
    return { ok: false, message: `${cycleError}，已挡回` }
  }
  const dateError = checkLastDate(input.上次校准日期, today)
  if (dateError) {
    return { ok: false, message: `${dateError}，已挡回` }
  }
  const rows = listRows(CALIBRATION_KEY)
  const inflight = rows.find(
    (row) => String(row['仪器编号']) === 仪器编号 && String(row.status) !== '已确认',
  )
  if (inflight) {
    return {
      ok: false,
      message: `仪器「${仪器编号}」已有在途送检记录（#${inflight.id}，${inflight.status}），重复送检只算一次`,
    }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: '待送检',
    pending: true,
    abnormal: false,
    仪器编号,
    仪器名称: input.仪器名称,
    检测线: input.检测线,
    '校准周期(月)': input.校准周期月,
    上次校准日期: input.上次校准日期,
    证书编号: '',
    送检人: '',
    计量确认结论: '',
  }
  row.abnormal = computeAbnormal(row, today)
  saveRows(CALIBRATION_KEY, [...rows, row])
  return { ok: true, message: `仪器「${仪器编号}」已登记台账，当前状态「待送检」`, id }
}

// 状态流转：只能一节一节往前走，跨级的拒收。
// 登记送检时由送检人登记证书编号；计量确认结论由计量组出具。
export function advanceCalibration(
  id: number,
  action: string,
  payload: AdvancePayload = {},
): ActionResult {
  const step = ACTION_STEPS[action]
  if (!step) {
    return { ok: false, message: `仪器校准记录没有登记「${action}」这个动作` }
  }
  const rows = listRows(CALIBRATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的仪器校准记录` }
  }
  const row = rows[index]
  const current = String(row.status)
  if (current !== step.from) {
    if (current === step.to) {
      return { ok: false, message: `记录已经是「${step.to}」，不用重复操作` }
    }
    if (FLOW.indexOf(current) >= 0 && FLOW.indexOf(current) < FLOW.indexOf(step.from)) {
      return {
        ok: false,
        message: `状态需一节一节流转，不能从「${current}」跨到「${step.to}」，请先完成前一节「${FLOW[FLOW.indexOf(current) + 1]}」`,
      }
    }
    return { ok: false, message: `记录已走到「${current}」，不能再回退到「${step.to}」` }
  }
  const updated: EntryRow = { ...row, status: step.to }
  if (action === '登记送检') {
    const 送检人 = (payload.送检人 ?? '').trim()
    const 证书编号 = (payload.证书编号 ?? '').trim()
    if (送检人 === '' || 证书编号 === '') {
      return { ok: false, message: '登记送检要由送检人登记证书编号，送检人和证书编号都不能空' }
    }
    updated['送检人'] = 送检人
    updated['证书编号'] = 证书编号
  }
  if (action === '登记校准结果') {
    const 校准日期 = (payload.校准日期 ?? '').trim()
    const dateError = checkLastDate(校准日期, todayIso())
    if (dateError) {
      return { ok: false, message: `${dateError}，已挡回` }
    }
    updated['上次校准日期'] = 校准日期
  }
  if (action === '出具计量确认') {
    const 确认结论 = (payload.确认结论 ?? '').trim()
    if (!CONFIRM_RESULTS.includes(确认结论)) {
      return { ok: false, message: `计量确认结论只能由计量组出具，可选：${CONFIRM_RESULTS.join('、')}` }
    }
    updated['计量确认结论'] = 确认结论
  }
  updated.pending = step.to !== '已确认'
  updated.abnormal = computeAbnormal(updated, todayIso())
  const next = [...rows]
  next[index] = updated
  saveRows(CALIBRATION_KEY, next)
  const suffix = action === '出具计量确认' ? '（计量组出具）' : ''
  return { ok: true, message: `仪器校准记录已${action}${suffix}，当前状态「${step.to}」` }
}
