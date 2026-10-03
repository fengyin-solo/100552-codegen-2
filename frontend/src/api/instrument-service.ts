import {
  buildReminders,
  confirmByMetrology,
  DEFAULT_LINE,
  METROLOGY_GROUP,
  registerInstrument,
  resubmitInstrument,
  submitForCalibration,
  validateLeadDays,
  type CalCycle,
  type CalReminder,
  type CalStatus,
  type ConfirmInput,
  type RegisterInput,
  type ResubmitInput,
  type ServiceResult,
  type SubmitInput,
} from '@/data/instrument'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

/**
 * 仪器校准台账的应用服务：台账页、灭菌验证清单、运营概览都只从这里取数，
 * 尤其到期提醒带模块级缓存——各入口取回来的属同一份；任何台账写操作后缓存失效。
 */

export const INSTRUMENT_KEY = 'instrumentcal'
const DEFAULT_LEAD_DAYS = 30

function rows(): EntryRow[] {
  return listRows(INSTRUMENT_KEY)
}

// 兼容历史行：缺的字段在读取时补齐，历史里的仪器编号按原样保留不动。
function normalize(row: EntryRow): EntryRow {
  return {
    ...row,
    检测线: row['检测线'] ? String(row['检测线']) : DEFAULT_LINE,
    校准周期: (String(row['校准周期'] ?? '年校') || '年校') as CalCycle,
    证书编号: row['证书编号'] ?? '',
    送检人: row['送检人'] ?? '',
    计量确认结论: row['计量确认结论'] ?? '',
    确认人: row['确认人'] ?? '',
    送检次数: Number(row['送检次数']) || 1,
  }
}

function persist(next: EntryRow[]): void {
  saveRows(INSTRUMENT_KEY, next.map(normalize))
  reminderCache = null
}

export function listInstruments(filters: { keyword?: string; 检测线?: string; 校准周期?: string } = {}): EntryRow[] {
  const keyword = (filters.keyword ?? '').trim()
  return rows()
    .map(normalize)
    .filter((row) => {
      if (keyword) {
        const haystack = [row['仪器编号'], row['仪器名称'], row['证书编号'], row['送检人']]
          .map((v) => String(v ?? ''))
          .join(' ')
        if (!haystack.includes(keyword)) {
          return false
        }
      }
      if (filters.检测线 && filters.检测线 !== '全部' && String(row['检测线']) !== filters.检测线) {
        return false
      }
      if (filters.校准周期 && filters.校准周期 !== '全部' && String(row['校准周期']) !== filters.校准周期) {
        return false
      }
      return true
    })
}

let reminderCache: { leadDays: number; items: CalReminder[] } | null = null

/** 到期提醒的唯一入口：同一提前天数下所有页面拿到的是同一批对象。 */
export function getReminders(leadDays: number = DEFAULT_LEAD_DAYS): CalReminder[] {
  const check = validateLeadDays(leadDays)
  if (!check.ok) {
    throw new Error(check.message)
  }
  if (reminderCache && reminderCache.leadDays === leadDays) {
    return reminderCache.items
  }
  const items = buildReminders(rows().map(normalize), leadDays)
  reminderCache = { leadDays, items }
  return items
}

/** 灭菌验证清单反映台账状态：按检测线取同一份提醒。 */
export function remindersForSterilize(leadDays: number = DEFAULT_LEAD_DAYS): CalReminder[] {
  return getReminders(leadDays).filter((item) => item.检测线 === '灭菌检测线')
}

export function reminderSummary(leadDays: number = DEFAULT_LEAD_DAYS) {
  const items = getReminders(leadDays)
  return {
    total: items.length,
    overdue: items.filter((item) => item.level === 'overdue').length,
    overdueUnconfirmed: items.filter((item) => item.overdueUnconfirmed).length,
    dueSoon: items.filter((item) => item.level === 'due-soon').length,
    unconfirmed: items.filter((item) => item.状态 !== '已确认合格').length,
  }
}

function commit(result: ServiceResult<EntryRow[]>): ServiceResult {
  if (!result.ok || !result.data) {
    return { ok: false, message: result.message }
  }
  persist(result.data)
  return { ok: true, message: result.message }
}

export function register(input: RegisterInput): ServiceResult {
  return commit(registerInstrument(rows().map(normalize), input))
}

export function submitCalibration(id: number, input: SubmitInput): ServiceResult {
  return commit(submitForCalibration(rows().map(normalize), id, input))
}

export function confirmCalibration(
  id: number,
  input: Omit<ConfirmInput, '确认组'> & { 确认组?: string },
): ServiceResult {
  return commit(
    confirmByMetrology(rows().map(normalize), id, {
      结论: input.结论,
      确认人: input.确认人,
      确认组: input.确认组 ?? METROLOGY_GROUP,
    }),
  )
}

export function resubmit(id: number, input: ResubmitInput): ServiceResult {
  return commit(resubmitInstrument(rows().map(normalize), id, input))
}

export function exportLedger(): { filename: string; content: string } {
  const header = [
    '编号',
    '仪器编号',
    '仪器名称',
    '检测线',
    '校准周期',
    '上次校准日期',
    '到期日期',
    '证书编号',
    '送检人',
    '计量确认结论',
    '确认人',
    '送检次数',
    '当前状态',
  ]
  const lines = [header.join(',')]
  for (const row of rows().map(normalize)) {
    lines.push(
      [
        row.id,
        row['仪器编号'],
        row['仪器名称'],
        row['检测线'],
        row['校准周期'],
        row['上次校准日期'],
        row['到期日期'],
        row['证书编号'],
        row['送检人'],
        row['计量确认结论'],
        row['确认人'],
        row['送检次数'],
        row.status,
      ]
        .map((cell) => String(cell ?? '').replace(/,/g, '，'))
        .join(','),
    )
  }
  return { filename: '仪器校准与计量确认台账.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadLedger(): void {
  const { filename, content } = exportLedger()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export type { CalReminder, CalStatus }
export { DEFAULT_LEAD_DAYS, METROLOGY_GROUP }
