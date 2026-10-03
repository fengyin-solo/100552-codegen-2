<template>
  <section class="page" data-module="sterilize">
    <header class="page-head">
      <div>
        <h2>灭菌验证管理</h2>
        <p class="page-desc">维护灭菌验证记录，围绕验证编号、灭菌设备、灭菌程序、装载方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记灭菌验证记录</button>
        <button class="btn" type="button" @click="exportRows">导出灭菌验证清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无灭菌验证数据，可先登记灭菌验证记录</td>
        </tr>
      </tbody>
    </table>

    <!-- 仪器校准状态反映到灭菌验证清单：与台账取的是同一份到期提醒 -->
    <section class="ster-cal-panel">
      <header class="panel-head">
        <h3>灭菌检测线 · 仪器校准与计量确认状态</h3>
        <RouterLink class="link" to="/instrumentcal">前往校准台账</RouterLink>
      </header>
      <p v-if="calAbnormalCount" class="panel-alert">
        本检测线有 {{ calAbnormalCount }} 台仪器逾期或确认不合格，相关灭菌验证所用仪器应停用核查后再放行。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>仪器编号</th>
            <th>仪器名称</th>
            <th>校准周期</th>
            <th>上次校准日期</th>
            <th>到期日期</th>
            <th>计量确认结论</th>
            <th>台账状态</th>
            <th>到期提醒</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in calReminders" :key="item.id" :class="calRowClass(item.level, item.状态)">
            <td>{{ item.仪器编号 }}</td>
            <td>{{ item.仪器名称 }}</td>
            <td>{{ item.校准周期 }}</td>
            <td>{{ calLastDate(item.id) }}</td>
            <td>{{ item.到期日期 }}</td>
            <td>{{ item.计量确认结论 || '待计量组出具' }}</td>
            <td>{{ item.状态 }}</td>
            <td class="cal-reminder-cell">{{ item.text }}</td>
          </tr>
          <tr v-if="!calReminders.length">
            <td colspan="8" class="empty-state">灭菌检测线暂无仪器台账记录</td>
          </tr>
        </tbody>
      </table>
      <p class="panel-note">提醒与台账页、运营概览同源，均由校准台账服务统一计算（业务日 {{ todayIso }}）。</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条灭菌验证记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listInstruments, remindersForSterilize } from '@/api/instrument-service'
import { TODAY_ISO, type CalReminder, type CalStatus } from '@/data/instrument'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('sterilize')
const columns = ["验证编号", "灭菌设备", "灭菌程序", "装载方式", "温度探头数", "灭菌保持时间", "验证日期", "验证状态"]
const actions = ["提交验证", "确认验证", "作废验证"]
const statuses = ["待验证", "灭菌中", "已验证", "已失效"]
const stats = [{"label": "待验证程序", "value": 0}, {"label": "灭菌中批次", "value": 0}, {"label": "已验证程序", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 灭菌检测线的仪器校准状态：直接消费台账服务，和台账页拿到的是同一份到期提醒。
const todayIso = TODAY_ISO
const calReminders = ref<CalReminder[]>([])
const calInstruments = ref<EntryRow[]>([])
const calAbnormalCount = computed(
  () =>
    calReminders.value.filter(
      (item) => item.overdueUnconfirmed || item.状态 === ('已确认不合格' as CalStatus),
    ).length,
)

function calLastDate(id: number): string {
  const hit = calInstruments.value.find((row) => Number(row.id) === id)
  return hit ? String(hit['上次校准日期'] ?? '—') : '—'
}

function calRowClass(level: CalReminder['level'], status: CalStatus): string {
  if (status === '已确认不合格') {
    return 'cal-row-bad'
  }
  if (level === 'overdue') {
    return 'cal-row-overdue'
  }
  if (level === 'due-soon') {
    return 'cal-row-soon'
  }
  return ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '灭菌验证记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    calReminders.value = remindersForSterilize()
    calInstruments.value = listInstruments({ 检测线: '灭菌检测线' })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '灭菌验证列表读取失败'
  }
}

onMounted(reload)
</script>
