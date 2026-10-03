<template>
  <article class="cal-card" :class="cardClass">
    <header class="card-head">
      <strong class="card-code">{{ row['仪器编号'] }}</strong>
      <span class="card-status" :class="statusClass">{{ row.status }}</span>
    </header>
    <p class="card-name">{{ row['仪器名称'] }}</p>
    <dl class="card-fields">
      <div><dt>检测线</dt><dd>{{ lineLabel }}</dd></div>
      <div><dt>上次校准</dt><dd>{{ row['上次校准日期'] ?? '—' }}</dd></div>
      <div><dt>到期日期</dt><dd :class="reminder && reminder.level !== 'normal' ? 'due-hot' : ''">
        {{ reminder ? reminder.到期日期 : row['到期日期'] ?? '—' }}
      </dd></div>
      <div><dt>证书编号</dt><dd>{{ row['证书编号'] || '未登记' }}</dd></div>
      <div><dt>送检人</dt><dd>{{ row['送检人'] || '—' }}</dd></div>
      <div>
        <dt>计量确认结论</dt>
        <dd :class="conclusionClass">{{ row['计量确认结论'] || '待计量组出具' }}</dd>
      </div>
      <div><dt>送检次数</dt><dd>第 {{ row['送检次数'] || 1 }} 次（同一台）</dd></div>
    </dl>
    <p v-if="reminder" class="card-reminder" :class="`rem-${reminder.level}`">
      <span class="reminder-dot"></span>{{ reminder.text }}
    </p>
    <footer class="card-actions">
      <button
        v-if="String(row.status) === '待送检'"
        class="link"
        type="button"
        @click="$emit('submit', row)"
      >
        送检登记
      </button>
      <button
        v-if="String(row.status) === '已送检待确认'"
        class="link"
        type="button"
        :disabled="role !== '计量组'"
        :title="role === '计量组' ? '计量组出具确认结论' : '计量确认结论由计量组出具'"
        @click="$emit('confirm', row)"
      >
        {{ role === '计量组' ? '计量确认' : '仅计量组可确认' }}
      </button>
      <button
        v-if="String(row.status) === '已确认合格' || String(row.status) === '已确认不合格'"
        class="link"
        type="button"
        @click="$emit('resubmit', row)"
      >
        重新送检
      </button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { CalReminder } from '@/data/instrument'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  row: EntryRow
  reminder?: CalReminder
  role: string
}>()

defineEmits<{
  (e: 'submit', row: EntryRow): void
  (e: 'confirm', row: EntryRow): void
  (e: 'resubmit', row: EntryRow): void
}>()

const lineLabel = computed(() => {
  const value = String(props.row['检测线'] ?? '')
  return value || '未分组'
})

const cardClass = computed(() => {
  if (props.reminder?.overdueUnconfirmed) {
    return 'is-overdue-unconfirmed'
  }
  if (props.reminder?.level === 'overdue') {
    return 'is-overdue'
  }
  if (props.reminder?.level === 'due-soon') {
    return 'is-due-soon'
  }
  if (String(props.row.status) === '已确认不合格') {
    return 'is-rejected'
  }
  return ''
})

const statusClass = computed(() => {
  const map: Record<string, string> = {
    待送检: 'tag-pending',
    已送检待确认: 'tag-waiting',
    已确认合格: 'tag-ok',
    已确认不合格: 'tag-bad',
  }
  return map[String(props.row.status)] ?? ''
})

const conclusionClass = computed(() => {
  const value = String(props.row['计量确认结论'] ?? '')
  if (value === '合格') {
    return 'conclusion-ok'
  }
  if (value === '不合格') {
    return 'conclusion-bad'
  }
  return 'conclusion-empty'
})
</script>
