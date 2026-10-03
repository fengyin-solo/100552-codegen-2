<template>
  <section class="page" data-module="calibration">
    <header class="page-head">
      <div>
        <h2>仪器校准与计量确认台账</h2>
        <p class="page-desc">按校准周期分栏排列，逐栏呈现仪器编号、上次校准日期、计量确认结论与到期提醒；仪器按检测线分组，状态一节一节流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出校准台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section v-if="overdueItems.length" class="panel overdue-panel">
      <h3>逾期未确认（{{ overdueItems.length }} 台，单独列出）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>仪器编号</th>
            <th>仪器名称</th>
            <th>检测线</th>
            <th>上次校准日期</th>
            <th>到期日期</th>
            <th>逾期天数</th>
            <th>当前状态</th>
            <th>计量确认结论</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in overdueItems" :key="item.id">
            <td>{{ item.仪器编号 }}</td>
            <td>{{ item.仪器名称 }}</td>
            <td>{{ item.检测线 }}</td>
            <td>{{ item.上次校准日期 }}</td>
            <td>{{ item.到期日期 }}</td>
            <td>{{ -item.剩余天数 }} 天</td>
            <td>{{ item.status }}</td>
            <td>{{ item.计量确认结论 || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="board.rejected.length" class="panel rejected-panel">
      <h3>越界 / 超限被挡回（{{ board.rejected.length }} 条）</h3>
      <p v-for="item in board.rejected" :key="item.id" class="rejected-line">
        #{{ item.id }} {{ item.仪器编号 }}：{{ item.reason }}
      </p>
    </section>

    <form class="filter-bar" @submit.prevent="submitCreate">
      <label class="filter-item">
        <span>仪器编号（原样保留）</span>
        <input v-model="createForm.仪器编号" placeholder="如 EQ-97-011" />
      </label>
      <label class="filter-item">
        <span>仪器名称</span>
        <input v-model="createForm.仪器名称" placeholder="如 酸度计" />
      </label>
      <label class="filter-item">
        <span>检测线</span>
        <input v-model="createForm.检测线" list="calibration-lines" placeholder="选择或新填" />
        <datalist id="calibration-lines">
          <option v-for="line in detectLines" :key="line" :value="line" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>校准周期（月，1–36）</span>
        <input v-model="createForm.校准周期月" type="number" min="1" max="36" placeholder="12" />
      </label>
      <label class="filter-item">
        <span>上次校准日期</span>
        <input v-model="createForm.上次校准日期" type="date" />
      </label>
      <button class="btn primary" type="submit">登记仪器台账</button>
    </form>

    <form v-if="activeAction" class="panel action-panel" @submit.prevent="submitAction">
      <h3>{{ activeAction.action }}：{{ activeAction.仪器编号 }}</h3>
      <div class="filter-bar">
        <template v-if="activeAction.action === '登记送检'">
          <label class="filter-item">
            <span>送检人</span>
            <input v-model="actionForm.送检人" placeholder="送检人姓名" />
          </label>
          <label class="filter-item">
            <span>证书编号</span>
            <input v-model="actionForm.证书编号" placeholder="由送检人登记" />
          </label>
        </template>
        <template v-else-if="activeAction.action === '登记校准结果'">
          <label class="filter-item">
            <span>校准日期</span>
            <input v-model="actionForm.校准日期" type="date" />
          </label>
        </template>
        <template v-else>
          <label class="filter-item">
            <span>计量确认结论（计量组出具）</span>
            <select v-model="actionForm.确认结论">
              <option value="" disabled>请选择结论</option>
              <option v-for="item in confirmResults" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
        </template>
        <button class="btn primary" type="submit">确认{{ activeAction.action }}</button>
        <button class="btn ghost" type="button" @click="activeAction = null">取消</button>
      </div>
    </form>

    <section v-for="group in cycleGroups" :key="group.cycle" class="panel cycle-panel">
      <h3>校准周期：{{ group.cycle }} 个月（{{ group.count }} 台）</h3>
      <div v-for="line in group.lines" :key="line.name" class="line-group">
        <h4 class="line-title">检测线：{{ line.name }}</h4>
        <table class="data-table">
          <thead>
            <tr>
              <th>仪器编号</th>
              <th>仪器名称</th>
              <th>上次校准日期</th>
              <th>计量确认结论</th>
              <th>到期提醒</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in line.rows" :key="row.id">
              <td>{{ row.仪器编号 }}</td>
              <td>{{ row.仪器名称 }}</td>
              <td>{{ row.上次校准日期 }}</td>
              <td>{{ row.计量确认结论 || '—' }}</td>
              <td>{{ reminderText(row.id) }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button
                  v-if="nextAction(row.status)"
                  class="link"
                  type="button"
                  @click="openAction(row)"
                >
                  {{ nextAction(row.status) }}
                </button>
                <span v-else class="muted">已办结</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 台仪器 · 到期提醒与运营概览、灭菌验证清单同一份</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  CALIBRATION_KEY,
  CONFIRM_RESULTS,
  advanceCalibration,
  calibrationReminders,
  createCalibration,
  overdueUnconfirmed,
  type ReminderBoard,
} from '@/api/calibration-service'
import { downloadEntries, listEntries } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const statuses = ['待送检', '已送检', '已校准', '已确认']
const confirmResults = CONFIRM_RESULTS

// 状态 → 下一节动作：已确认没有后续动作，跨级动作在服务端一律拒收。
const NEXT_ACTION: Record<string, string> = {
  待送检: '登记送检',
  已送检: '登记校准结果',
  已校准: '出具计量确认',
}

type LedgerRow = {
  id: number
  仪器编号: string
  仪器名称: string
  检测线: string
  校准周期月: number
  上次校准日期: string
  计量确认结论: string
  status: string
}

const rows = ref<EntryRow[]>([])
const board = ref<ReminderBoard>({ generatedAt: '', items: [], rejected: [] })
const errorMessage = ref('')
const noticeMessage = ref('')

const createForm = reactive({
  仪器编号: '',
  仪器名称: '',
  检测线: '',
  校准周期月: 12,
  上次校准日期: '',
})

const activeAction = ref<{ id: number; action: string; 仪器编号: string } | null>(null)
const actionForm = reactive({ 送检人: '', 证书编号: '', 校准日期: '', 确认结论: '' })

const stats = computed(() => [
  { label: '台账仪器数', value: rows.value.length },
  { label: '流程中仪器', value: rows.value.filter((row) => String(row.status) !== '已确认').length },
  { label: '逾期未确认', value: overdueItems.value.length },
  { label: '越界超限挡回', value: board.value.rejected.length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const overdueItems = computed(() => overdueUnconfirmed(board.value))

const reminderById = computed(() => new Map(board.value.items.map((item) => [item.id, item])))

const detectLines = computed(() => {
  const lines = new Set(['理化检测线', '微生物检测线', '灭菌检测线'])
  for (const row of rows.value) {
    const line = String(row['检测线'] ?? '')
    if (line) {
      lines.add(line)
    }
  }
  return [...lines]
})

function toLedgerRow(row: EntryRow): LedgerRow {
  return {
    id: Number(row.id),
    仪器编号: String(row['仪器编号'] ?? ''),
    仪器名称: String(row['仪器名称'] ?? ''),
    检测线: String(row['检测线'] ?? '') || '未分组',
    校准周期月: Number(row['校准周期(月)'] ?? 0),
    上次校准日期: String(row['上次校准日期'] ?? ''),
    计量确认结论: String(row['计量确认结论'] ?? ''),
    status: String(row.status),
  }
}

// 先按校准周期分栏，栏内再按检测线分组。
const cycleGroups = computed(() => {
  const byCycle = new Map<number, LedgerRow[]>()
  for (const row of rows.value.map(toLedgerRow)) {
    const list = byCycle.get(row.校准周期月) ?? []
    list.push(row)
    byCycle.set(row.校准周期月, list)
  }
  return [...byCycle.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cycle, list]) => {
      const byLine = new Map<string, LedgerRow[]>()
      for (const item of list) {
        const group = byLine.get(item.检测线) ?? []
        group.push(item)
        byLine.set(item.检测线, group)
      }
      const lines = [...byLine.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'))
        .map(([name, lineRows]) => ({ name, rows: lineRows }))
      return { cycle, count: list.length, lines }
    })
})

function reminderText(id: number): string {
  const item = reminderById.value.get(id)
  if (!item) {
    return '—'
  }
  if (item.逾期) {
    return `${item.到期日期}（已逾期 ${-item.剩余天数} 天）`
  }
  return `${item.到期日期}（剩 ${item.剩余天数} 天）`
}

function nextAction(status: string): string {
  return NEXT_ACTION[status] ?? ''
}

function openAction(row: LedgerRow) {
  const action = nextAction(row.status)
  if (!action) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  activeAction.value = { id: row.id, action, 仪器编号: row.仪器编号 }
  actionForm.送检人 = ''
  actionForm.证书编号 = ''
  actionForm.校准日期 = ''
  actionForm.确认结论 = ''
}

function submitAction() {
  if (!activeAction.value) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = advanceCalibration(activeAction.value.id, activeAction.value.action, { ...actionForm })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  activeAction.value = null
  reload()
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = createCalibration({
    仪器编号: createForm.仪器编号,
    仪器名称: createForm.仪器名称,
    检测线: createForm.检测线,
    校准周期月: Number(createForm.校准周期月),
    上次校准日期: createForm.上次校准日期,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  createForm.仪器编号 = ''
  createForm.仪器名称 = ''
  createForm.检测线 = ''
  createForm.校准周期月 = 12
  createForm.上次校准日期 = ''
  reload()
}

function exportRows() {
  downloadEntries(CALIBRATION_KEY)
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listEntries(CALIBRATION_KEY).items
    board.value = calibrationReminders()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '仪器校准台账读取失败'
  }
}

onMounted(reload)
</script>
