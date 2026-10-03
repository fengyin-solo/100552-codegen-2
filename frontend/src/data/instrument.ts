import type { EntryRow } from './types'

/**
 * 仪器校准与计量确认台账（单设一卷）。
 *
 * 设备科与各组散记的校准记录在这里统一归口：
 * - 按校准周期（月/季/半年/年）分栏；逾期未确认单独成区。
 * - 状态一节一节流转（待送检 → 已送检待确认 → 已确认合格 / 已确认不合格 → 重新送检），跨级拒收。
 * - 送检人登记证书编号；计量确认结论只能由计量组出。
 * - 同一台仪器重复送检只算一次：重新送检只更新当前那一台，不新增台账记录。
 * - 到期提醒在本文件内唯一计算，台账、灭菌验证清单、概览各入口取回来的属同一份。
 */

// 业务基准日：演示数据围绕它布置。接回真实系统时改为 new Date() 即可。
export const TODAY_ISO = '2026-10-03'

export const CAL_CYCLES = ['月校', '季校', '半年校', '年校'] as const
export type CalCycle = (typeof CAL_CYCLES)[number]

export const CAL_CYCLE_MONTHS: Record<CalCycle, number> = {
  月校: 1,
  季校: 3,
  半年校: 6,
  年校: 12,
}

// 仪器按检测线分组。历史台账没有检测线概念的，归入「未分组」兼容展示。
export const DEFAULT_LINE = '未分组'
export const DETECTION_LINES = [
  '灭菌检测线',
  '无菌检测线',
  '微生物限度检测线',
  '理化检测线',
  '工艺用水检测线',
  '成品检测线',
  DEFAULT_LINE,
] as const
export type DetectionLine = (typeof DETECTION_LINES)[number]

export const CAL_STATUSES = ['待送检', '已送检待确认', '已确认合格', '已确认不合格'] as const
export type CalStatus = (typeof CAL_STATUSES)[number]

// 状态一节一节流转：只允许走到相邻的下一节，跨级一律拒收。
// 「重新送检」是合格/不合格之后的新一轮起点，不算跨级，重复送检只落在同一台仪器上。
export const NEXT_STATUS: Record<CalStatus, CalStatus | null> = {
  待送检: '已送检待确认',
  已送检待确认: null, // 下一节由计量组给出结论：合格或不合格，两条路都只走一节
  已确认合格: '待送检',
  已确认不合格: '待送检',
}
export const CONFIRM_TARGETS: CalStatus[] = ['已确认合格', '已确认不合格']

export const METROLOGY_GROUP = '计量组'

export const MIN_ISO = '2000-01-01'
// 到期提醒边界：提前提醒天数只接受 1~90 天；越界的挡回。
export const MIN_LEAD_DAYS = 1
export const MAX_LEAD_DAYS = 90

export type ServiceResult<T = undefined> = { ok: boolean; message: string; data?: T }

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}
/** 加上若干个月（按日历月进位，溢出取当月最后一天）。 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const base = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const day = Math.min(d, lastDay)
  return [
    String(base.getUTCFullYear()),
    String(base.getUTCMonth() + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

export function dueOf(lastCalDate: string, cycle: CalCycle): string {
  return addMonths(lastCalDate, CAL_CYCLE_MONTHS[cycle])
}

/** 到期日相对业务日的天数：负数表示已逾期。 */
export function daysUntil(dueIso: string, todayIso: string = TODAY_ISO): number {
  const ms = Date.parse(`${dueIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

export type ReminderLevel = 'overdue' | 'due-soon' | 'normal'

export type CalReminder = {
  id: number
  仪器编号: string
  仪器名称: string
  检测线: string
  校准周期: CalCycle
  状态: CalStatus
  到期日期: string
  计量确认结论: string
  level: ReminderLevel
  daysLeft: number
  text: string
  // 逾期且计量确认还没做完（未确认/确认不合格），单独成区展示。
  overdueUnconfirmed: boolean
}

function levelOf(row: EntryRow, due: string, leadDays: number) {
  const days = daysUntil(due)
  const status = String(row.status) as CalStatus
  const confirmedOk = status === '已确认合格'
  const overdue = days < 0
  if (overdue) {
    return {
      level: 'overdue' as const,
      overdueUnconfirmed: !confirmedOk,
    }
  }
  return {
    level: (days <= leadDays ? 'due-soon' : 'normal') as ReminderLevel,
    overdueUnconfirmed: false,
  }
}

function reminderText(level: ReminderLevel, days: number, confirmed: boolean): string {
  if (level === 'overdue') {
    const n = Math.abs(days)
    return confirmed
      ? `校准已逾期 ${n} 天，合格确认覆盖的周期已到期，请安排重新送检`
      : `校准已逾期 ${n} 天且计量确认未完成，请立即停用并补做确认`
  }
  if (level === 'due-soon') {
    return days === 0 ? '校准今日到期，请尽快送检' : `校准将于 ${days} 天后到期，请提前安排送检`
  }
  return '校准有效，距到期尚有余量'
}

/** 到期提醒只在这里算一份：各入口取到的提醒结构完全一致。 */
export function buildReminders(
  rows: EntryRow[],
  leadDays: number,
  todayIso: string = TODAY_ISO,
): CalReminder[] {
  return rows.map((row) => {
    const cycle = (String(row['校准周期']) || '年校') as CalCycle
    const last = String(row['上次校准日期'] ?? '')
    const due = isIsoDate(last) ? dueOf(last, cycle) : ''
    const days = due ? daysUntil(due, todayIso) : Number.POSITIVE_INFINITY
    const { level, overdueUnconfirmed } = due
      ? levelOf(row, due, leadDays)
      : { level: 'normal' as ReminderLevel, overdueUnconfirmed: false }
    const confirmed = String(row.status) === '已确认合格'
    return {
      id: Number(row.id),
      仪器编号: String(row['仪器编号'] ?? ''),
      仪器名称: String(row['仪器名称'] ?? ''),
      检测线: String(row['检测线'] ?? DEFAULT_LINE),
      校准周期: cycle,
      状态: String(row.status) as CalStatus,
      到期日期: due || '—',
      计量确认结论: String(row['计量确认结论'] ?? ''),
      level,
      daysLeft: days,
      text: due ? reminderText(level, days, confirmed) : '上次校准日期缺失，无法计算到期',
      overdueUnconfirmed,
    }
  })
}

export type RegisterInput = {
  仪器编号: string
  仪器名称: string
  检测线: string
  校准周期: string
  上次校准日期: string
  登记人: string
}

export type SubmitInput = {
  证书编号: string
  送检人: string
}

export type ConfirmInput = {
  结论: CalStatus
  确认人: string
  确认组: string
}

export type ResubmitInput = {
  证书编号: string
  送检人: string
  上次校准日期: string
}

function requireIso(
  value: string,
  label: string,
  range = true,
): ServiceResult<EntryRow[]> {
  if (!isIsoDate(value)) {
    return { ok: false, message: `${label}不是有效日期（YYYY-MM-DD）` }
  }
  if (range && (value < MIN_ISO || value > TODAY_ISO)) {
    return { ok: false, message: `${label}越界：需在 ${MIN_ISO} 至 ${TODAY_ISO} 之间` }
  }
  return { ok: true, message: '' }
}

function findRow(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

function guardTransition(row: EntryRow, expected: CalStatus): ServiceResult<EntryRow[]> {
  const current = String(row.status) as CalStatus
  if (current !== expected) {
    return {
      ok: false,
      message: `状态一节一节流转，${String(row['仪器编号'])} 当前为「${current}」，不能从该状态跨级办理（应处于「${expected}」）`,
    }
  }
  return { ok: true, message: '' }
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

export function validateLeadDays(value: number): ServiceResult {
  if (!Number.isInteger(value) || value < MIN_LEAD_DAYS || value > MAX_LEAD_DAYS) {
    return {
      ok: false,
      message: `提前提醒天数超限：只接受 ${MIN_LEAD_DAYS}~${MAX_LEAD_DAYS} 天，越界的挡回`,
    }
  }
  return { ok: true, message: '' }
}

export function registerInstrument(
  rows: EntryRow[],
  input: RegisterInput,
): ServiceResult<EntryRow[]> {
  const code = input.仪器编号.trim()
  if (!code) {
    return { ok: false, message: '仪器编号不能为空' }
  }
  // 历史里的仪器编号按原样保留；新登记的也逐字保留，只比对完全相同的重复编号。
  if (rows.some((row) => String(row['仪器编号']) === code)) {
    return { ok: false, message: `仪器编号「${code}」已在台账中，同一台仪器不重复立卷` }
  }
  if (!input.仪器名称.trim()) {
    return { ok: false, message: '仪器名称不能为空' }
  }
  if (!(CAL_CYCLES as readonly string[]).includes(input.校准周期)) {
    return { ok: false, message: `校准周期只能是：${CAL_CYCLES.join('、')}` }
  }
  const dateCheck = requireIso(input.上次校准日期, '上次校准日期')
  if (!dateCheck.ok) {
    return dateCheck
  }
  const cycle = input.校准周期 as CalCycle
  const row: EntryRow = {
    id: nextId(rows),
    status: '待送检',
    pending: true,
    abnormal: false,
    仪器编号: code,
    仪器名称: input.仪器名称.trim(),
    检测线: input.检测线 || DEFAULT_LINE,
    校准周期: cycle,
    上次校准日期: input.上次校准日期,
    到期日期: dueOf(input.上次校准日期, cycle),
    证书编号: '',
    送检人: '',
    计量确认结论: '',
    确认人: '',
    登记人: input.登记人.trim(),
    送检次数: 1,
  }
  return { ok: true, message: `仪器「${code}」已立卷，状态「待送检」`, data: [...rows, row] }
}

export function submitForCalibration(
  rows: EntryRow[],
  id: number,
  input: SubmitInput,
): ServiceResult<EntryRow[]> {
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的仪器台账记录` }
  }
  const guard = guardTransition(row, '待送检')
  if (!guard.ok) {
    return guard
  }
  const cert = input.证书编号.trim()
  if (!cert) {
    return { ok: false, message: '送检必须登记证书编号' }
  }
  if (!input.送检人.trim()) {
    return { ok: false, message: '送检人不能为空' }
  }
  // 同一台仪器重复送检只算一次：同证书编号再次提交挡回（重新送检时证书编号应更新）。
  if (rows.some((other) => String(other['证书编号']) === cert)) {
    return {
      ok: false,
      message: `证书编号「${cert}」已登记过，同一台仪器重复送检只算一次，请使用新周期的证书编号`,
    }
  }
  const updated: EntryRow = {
    ...row,
    status: '已送检待确认',
    pending: true,
    abnormal: false,
    证书编号: cert,
    送检人: input.送检人.trim(),
  }
  const next = rows.map((item) => (Number(item.id) === id ? updated : item))
  return { ok: true, message: `仪器「${updated['仪器编号']}」已送检，待计量组确认`, data: next }
}

export function confirmByMetrology(
  rows: EntryRow[],
  id: number,
  input: ConfirmInput,
): ServiceResult<EntryRow[]> {
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的仪器台账记录` }
  }
  // 计量确认结论由计量组出：组外角色给结论一律挡回。
  if (input.确认组 !== METROLOGY_GROUP) {
    return { ok: false, message: '计量确认结论只能由计量组出具，跨组操作拒收' }
  }
  if (!input.确认人.trim()) {
    return { ok: false, message: '确认人不能为空' }
  }
  const guard = guardTransition(row, '已送检待确认')
  if (!guard.ok) {
    return guard
  }
  if (!CONFIRM_TARGETS.includes(input.结论)) {
    return { ok: false, message: '计量确认结论只能是「已确认合格」或「已确认不合格」' }
  }
  const passed = input.结论 === '已确认合格'
  const updated: EntryRow = {
    ...row,
    status: input.结论,
    pending: false,
    abnormal: !passed,
    计量确认结论: passed ? '合格' : '不合格',
    确认人: input.确认人.trim(),
  }
  const next = rows.map((item) => (Number(item.id) === id ? updated : item))
  return {
    ok: true,
    message: `计量组已确认「${updated['仪器编号']}」：${updated['计量确认结论']}`,
    data: next,
  }
}

/**
 * 重新送检：合格/不合格仪器开启新一轮校准。
 * 同一台仪器重复送检只算一次——只更新这一行（状态回待送检、次数加一），不新增台账记录。
 */
export function resubmitInstrument(
  rows: EntryRow[],
  id: number,
  input: ResubmitInput,
): ServiceResult<EntryRow[]> {
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的仪器台账记录` }
  }
  const current = String(row.status) as CalStatus
  if (current !== '已确认合格' && current !== '已确认不合格') {
    return {
      ok: false,
      message: `只有已出具确认结论的仪器才能重新送检，当前「${current}」，跨级拒收`,
    }
  }
  const cert = input.证书编号.trim()
  if (!cert) {
    return { ok: false, message: '重新送检必须登记新周期的证书编号' }
  }
  if (cert === String(row['证书编号'] ?? '')) {
    return {
      ok: false,
      message: '新证书编号不能与上一周期相同，重复送检只算一次',
    }
  }
  if (rows.some((other) => Number(other.id) !== id && String(other['证书编号']) === cert)) {
    return { ok: false, message: `证书编号「${cert}」已被其他仪器登记` }
  }
  if (!input.送检人.trim()) {
    return { ok: false, message: '送检人不能为空' }
  }
  const dateCheck = requireIso(input.上次校准日期, '上次校准日期')
  if (!dateCheck.ok) {
    return dateCheck
  }
  if (input.上次校准日期 < String(row['上次校准日期'] ?? MIN_ISO)) {
    return {
      ok: false,
      message: '新一轮上次校准日期不能早于上一轮，日期越界挡回',
    }
  }
  const cycle = (String(row['校准周期']) || '年校') as CalCycle
  const updated: EntryRow = {
    ...row,
    status: '待送检',
    pending: true,
    abnormal: false,
    上次校准日期: input.上次校准日期,
    到期日期: dueOf(input.上次校准日期, cycle),
    证书编号: cert,
    送检人: input.送检人.trim(),
    // 上一轮结论留痕，计量确认结论字段从本轮重新置空。
    上次计量确认结论: row['计量确认结论'] ?? '',
    计量确认结论: '',
    确认人: '',
    送检次数: (Number(row['送检次数']) || 1) + 1,
  }
  const next = rows.map((item) => (Number(item.id) === id ? updated : item))
  return {
    ok: true,
    message: `仪器「${updated['仪器编号']}」已重新送检（第 ${updated['送检次数']} 次），仍为同一台仪器`,
    data: next,
  }
}
