<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <section class="panel reminder-panel">
      <h3>仪器校准到期提醒</h3>
      <p class="reminder-summary">
        逾期未确认 {{ overdueCount }} 台 · 越界/超限挡回 {{ rejectedCount }} 条（与校准台账、灭菌验证清单同一份）
      </p>
      <table class="data-table">
        <thead>
          <tr><th>仪器编号</th><th>检测线</th><th>到期日期</th><th>到期提醒</th><th>台账状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in topReminders" :key="item.id">
            <td>{{ item.仪器编号 }}</td>
            <td>{{ item.检测线 }}</td>
            <td>{{ item.到期日期 }}</td>
            <td>{{ item.逾期 ? `已逾期 ${-item.剩余天数} 天` : `剩 ${item.剩余天数} 天` }}</td>
            <td>{{ item.status }}</td>
          </tr>
          <tr v-if="!topReminders.length">
            <td colspan="5" class="empty-state">暂无仪器校准提醒</td>
          </tr>
        </tbody>
      </table>
    </section>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { calibrationReminders, overdueUnconfirmed, type ReminderItem } from '@/api/calibration-service'
import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const topReminders = ref<ReminderItem[]>([])
const overdueCount = ref(0)
const rejectedCount = ref(0)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  // 与校准台账页、灭菌验证清单取的是同一份到期提醒。
  const board = calibrationReminders()
  topReminders.value = board.items.slice(0, 5)
  overdueCount.value = overdueUnconfirmed(board).length
  rejectedCount.value = board.rejected.length
}

onMounted(refresh)
</script>
