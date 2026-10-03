<template>
  <section class="page" data-module="instrumentcal">
    <header class="page-head">
      <div>
        <h2>仪器校准与计量确认台账</h2>
        <p class="page-desc">
          设备科与各组校准记录归口一卷，按校准周期分栏；逾期未确认单独成区。送检人登记证书编号，计量确认结论由计量组出具。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">新仪器立卷</button>
        <button class="btn" type="button" @click="exportRows">导出台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card" :class="item.cls">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="cal-controls">
      <label class="filter-item">
        <span>当前办理角色</span>
        <select v-model="role">
          <option v-for="item in roleOptions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>提前提醒天数（1~90，越界挡回）</span>
        <input v-model.number="leadDaysInput" type="number" min="1" max="90" @change="applyLeadDays" />
      </label>
      <span v-if="leadError" class="error-text">{{ leadError }}</span>
      <span class="cal-today">业务日：{{ todayIso }}</span>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>关键字（编号/名称/证书/送检人）</span>
        <input v-model="filters.keyword" placeholder="按关键字检索" />
      </label>
      <label class="filter-item">
        <span>检测线</span>
        <select v-model="filters.检测线">
          <option value="全部">全部</option>
          <option v-for="line in lineOptions" :key="line" :value="line">{{ line }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p class="status-legend">
      <span class="legend-item">待送检：{{ countByStatus('待送检') }}</span>
      <span class="legend-item">已送检待确认：{{ countByStatus('已送检待确认') }}</span>
      <span class="legend-item">已确认合格：{{ countByStatus('已确认合格') }}</span>
      <span class="legend-item">已确认不合格：{{ countByStatus('已确认不合格') }}</span>
    </p>

    <!-- 逾期未确认：单独成区展示 -->
    <section v-if="overdueUnconfirmed.length" class="overdue-zone">
      <h3 class="zone-title">
        逾期未确认（{{ overdueUnconfirmed.length }} 台）
        <small>已过到期日且计量确认未完成，停用并立即补做确认</small>
      </h3>
      <div class="zone-cards">
        <CalInstrumentCard
          v-for="card in overdueUnconfirmed"
          :key="card.id"
          :row="card.row"
          :reminder="card.reminder"
          :role="role"
          @submit="openSubmit(card.row)"
          @confirm="openConfirm(card.row)"
          @resubmit="openResubmit(card.row)"
        />
      </div>
    </section>

    <!-- 按校准周期分栏 -->
    <div class="cal-board">
      <section v-for="cycle in cycles" :key="cycle" class="cal-column">
        <header class="column-head">
          <h3>{{ cycle }}</h3>
          <span class="column-count">{{ columns[cycle].length }} 台</span>
        </header>
        <div class="column-body">
          <CalInstrumentCard
            v-for="row in columns[cycle]"
            :key="String(row.id)"
            :row="row"
            :reminder="reminderMap.get(Number(row.id))"
            :role="role"
            @submit="openSubmit(row)"
            @confirm="openConfirm(row)"
            @resubmit="openResubmit(row)"
          />
          <p v-if="!columns[cycle].length" class="column-empty">本栏暂无仪器</p>
        </div>
      </section>
    </div>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 台仪器 · 到期提醒由台账服务统一计算，各入口取同一份</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 新仪器立卷 -->
    <div v-if="registerOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>新仪器立卷</h3>
        <label class="form-item"><span>仪器编号（历史编号按原样登记）</span>
          <input v-model="registerForm.仪器编号" placeholder="如 TMP-01" />
        </label>
        <label class="form-item"><span>仪器名称</span>
          <input v-model="registerForm.仪器名称" />
        </label>
        <label class="form-item"><span>检测线</span>
          <select v-model="registerForm.检测线">
            <option v-for="line in lineOptions" :key="line" :value="line">{{ line }}</option>
          </select>
        </label>
        <label class="form-item"><span>校准周期</span>
          <select v-model="registerForm.校准周期">
            <option v-for="cycle in cycles" :key="cycle" :value="cycle">{{ cycle }}</option>
          </select>
        </label>
        <label class="form-item"><span>上次校准日期</span>
          <input v-model="registerForm.上次校准日期" type="date" :min="MIN_ISO" :max="todayIso" />
        </label>
        <label class="form-item"><span>登记人</span>
          <input v-model="registerForm.登记人" />
        </label>
        <p class="form-hint">到期日期 = 上次校准日期 + 校准周期，由系统自动计算。</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="saveRegister">保存立卷</button>
          <button class="btn ghost" type="button" @click="closeAll">取消</button>
        </div>
      </div>
    </div>

    <!-- 送检登记：送检人登记证书编号 -->
    <div v-if="submitOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>送检登记 · {{ activeRow?.['仪器编号'] }}</h3>
        <p class="form-hint">状态一节一节流转：待送检 → 已送检待确认。同一台仪器重复送检只算一次。</p>
        <label class="form-item"><span>证书编号</span>
          <input v-model="submitForm.证书编号" placeholder="如 JL-2026-1008" />
        </label>
        <label class="form-item"><span>送检人</span>
          <input v-model="submitForm.送检人" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="saveSubmit">确认送检</button>
          <button class="btn ghost" type="button" @click="closeAll">取消</button>
        </div>
      </div>
    </div>

    <!-- 计量确认：只有计量组能出结论 -->
    <div v-if="confirmOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>计量确认 · {{ activeRow?.['仪器编号'] }}</h3>
        <p class="form-hint">
          证书 {{ activeRow?.['证书编号'] }} · 送检人 {{ activeRow?.['送检人'] }}。计量确认结论由计量组出具。
        </p>
        <label class="form-item"><span>确认组</span>
          <select v-model="confirmForm.确认组">
            <option value="计量组">计量组</option>
            <option value="设备科">设备科（无权出具，演示拒收）</option>
            <option value="检测组">检测组（无权出具，演示拒收）</option>
          </select>
        </label>
        <label class="form-item"><span>确认人</span>
          <input v-model="confirmForm.确认人" placeholder="如 计量组-高工" />
        </label>
        <label class="form-item"><span>计量确认结论</span>
          <select v-model="confirmForm.结论">
            <option value="已确认合格">合格</option>
            <option value="已确认不合格">不合格</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="saveConfirm">出具结论</button>
          <button class="btn ghost" type="button" @click="closeAll">取消</button>
        </div>
      </div>
    </div>

    <!-- 重新送检：同一台仪器开启新一轮，不新增记录 -->
    <div v-if="resubmitOpen" class="modal-mask" @click.self="closeAll">
      <div class="modal">
        <h3>重新送检 · {{ activeRow?.['仪器编号'] }}</h3>
        <p class="form-hint">同一台仪器重复送检只算一次：更新本行、送检次数加一，不另立台账。</p>
        <label class="form-item"><span>新一轮证书编号</span>
          <input v-model="resubmitForm.证书编号" />
        </label>
        <label class="form-item"><span>送检人</span>
          <input v-model="resubmitForm.送检人" />
        </label>
        <label class="form-item"><span>本轮上次校准日期</span>
          <input v-model="resubmitForm.上次校准日期" type="date" :min="String(activeRow?.['上次校准日期'] ?? MIN_ISO)" :max="todayIso" />
        </label>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="saveResubmit">重新送检</button>
          <button class="btn ghost" type="button" @click="closeAll">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  confirmCalibration,
  DEFAULT_LEAD_DAYS,
  downloadLedger,
  getReminders,
  listInstruments,
  register,
  resubmit,
  submitCalibration,
} from '@/api/instrument-service'
import {
  CAL_CYCLES,
  DETECTION_LINES,
  METROLOGY_GROUP,
  MIN_ISO,
  TODAY_ISO,
  validateLeadDays,
  type CalCycle,
  type CalReminder,
  type CalStatus,
} from '@/data/instrument'
import type { EntryRow } from '@/data/types'

import CalInstrumentCard from './InstrumentCard.vue'

const cycles: CalCycle[] = [...CAL_CYCLES]
const lineOptions = [...DETECTION_LINES]
const todayIso = TODAY_ISO

const roleOptions = ['设备科', '计量组', '灭菌检测线-送检人', '无菌检测线-送检人']
const role = ref('设备科')

const rows = ref<EntryRow[]>([])
const reminders = ref<CalReminder[]>([])
const errorMessage = ref('')
const leadError = ref('')
const leadDays = ref(DEFAULT_LEAD_DAYS)
const leadDaysInput = ref(DEFAULT_LEAD_DAYS)

const filters = reactive<{ keyword: string; 检测线: string }>({
  keyword: '',
  检测线: '全部',
})

const reminderMap = computed(() => new Map(reminders.value.map((item) => [item.id, item])))

const columns = computed<Record<CalCycle, EntryRow[]>>(() => {
  const grouped = Object.fromEntries(cycles.map((cycle) => [cycle, [] as EntryRow[]])) as Record<
    CalCycle,
    EntryRow[]
  >
  for (const row of rows.value) {
    const cycle = String(row['校准周期']) as CalCycle
    if (grouped[cycle]) {
      grouped[cycle].push(row)
    }
  }
  return grouped
})

const overdueUnconfirmed = computed(() =>
  reminders.value
    .filter((item) => item.overdueUnconfirmed)
    .map((item) => ({
      id: item.id,
      row: rows.value.find((row) => Number(row.id) === item.id) as EntryRow,
      reminder: item,
    }))
    .filter((item) => item.row),
)

const stats = computed(() => {
  const byStatus = (status: CalStatus) =>
    rows.value.filter((row) => String(row.status) === status).length
  return [
    { label: '待送检仪器', value: byStatus('待送检'), cls: '' },
    { label: '待计量确认', value: byStatus('已送检待确认'), cls: '' },
    {
      label: '逾期未确认',
      value: overdueUnconfirmed.value.length,
      cls: overdueUnconfirmed.value.length ? 'stat-danger' : '',
    },
    {
      label: '即将到期',
      value: reminders.value.filter((item) => item.level === 'due-soon').length,
      cls: 'stat-warn',
    },
  ]
})

function countByStatus(status: CalStatus): number {
  return rows.value.filter((row) => String(row.status) === status).length
}

function applyLeadDays() {
  leadError.value = ''
  const check = validateLeadDays(Number(leadDaysInput.value))
  if (!check.ok) {
    leadError.value = check.message
    leadDaysInput.value = leadDays.value
    return
  }
  leadDays.value = Number(leadDaysInput.value)
  reload()
}

function resetFilters() {
  filters.keyword = ''
  filters.检测线 = '全部'
  reload()
}

function exportRows() {
  downloadLedger()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listInstruments({ keyword: filters.keyword, 检测线: filters.检测线 })
    reminders.value = getReminders(leadDays.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '台账读取失败'
  }
}

// ---- 弹窗状态 ----
const registerOpen = ref(false)
const submitOpen = ref(false)
const confirmOpen = ref(false)
const resubmitOpen = ref(false)
const activeRow = ref<EntryRow | null>(null)

const registerForm = reactive({
  仪器编号: '',
  仪器名称: '',
  检测线: '灭菌检测线',
  校准周期: '年校' as CalCycle,
  上次校准日期: TODAY_ISO,
  登记人: '',
})
const submitForm = reactive({ 证书编号: '', 送检人: '' })
const confirmForm = reactive<{ 确认组: string; 确认人: string; 结论: CalStatus }>({
  确认组: METROLOGY_GROUP,
  确认人: '',
  结论: '已确认合格',
})
const resubmitForm = reactive({ 证书编号: '', 送检人: '', 上次校准日期: TODAY_ISO })

function closeAll() {
  registerOpen.value = false
  submitOpen.value = false
  confirmOpen.value = false
  resubmitOpen.value = false
  activeRow.value = null
  errorMessage.value = ''
}

function openRegister() {
  closeAll()
  registerForm.登记人 = role.value.includes('送检人')
    ? role.value.replace('-送检人', '') + '-送检人'
    : role.value === METROLOGY_GROUP
      ? '计量组-值班'
      : '设备科-值班'
  registerOpen.value = true
}

function openSubmit(row: EntryRow) {
  closeAll()
  activeRow.value = row
  submitForm.证书编号 = ''
  submitForm.送检人 = ''
  submitOpen.value = true
}

function openConfirm(row: EntryRow) {
  closeAll()
  activeRow.value = row
  confirmForm.确认组 = role.value === METROLOGY_GROUP ? METROLOGY_GROUP : '设备科'
  confirmForm.确认人 = role.value === METROLOGY_GROUP ? '计量组-高工' : ''
  confirmForm.结论 = '已确认合格'
  confirmOpen.value = true
}

function openResubmit(row: EntryRow) {
  closeAll()
  activeRow.value = row
  resubmitForm.证书编号 = ''
  resubmitForm.送检人 = ''
  resubmitForm.上次校准日期 = TODAY_ISO
  resubmitOpen.value = true
}

function run(message: string, ok: boolean) {
  errorMessage.value = message
  if (!ok) {
    return
  }
  closeAll()
  reload()
}

function saveRegister() {
  const result = register({ ...registerForm })
  run(result.message, result.ok)
}

function saveSubmit() {
  if (!activeRow.value) {
    return
  }
  const result = submitCalibration(Number(activeRow.value.id), { ...submitForm })
  run(result.message, result.ok)
}

function saveConfirm() {
  if (!activeRow.value) {
    return
  }
  const result = confirmCalibration(Number(activeRow.value.id), { ...confirmForm })
  run(result.message, result.ok)
}

function saveResubmit() {
  if (!activeRow.value) {
    return
  }
  const result = resubmit(Number(activeRow.value.id), { ...resubmitForm })
  run(result.message, result.ok)
}

onMounted(reload)
</script>
