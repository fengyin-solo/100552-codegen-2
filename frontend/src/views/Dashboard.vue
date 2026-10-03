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

    <section class="dash-reminder">
      <header class="panel-head">
        <h3>仪器校准到期提醒</h3>
        <RouterLink class="link" to="/instrumentcal">打开校准台账</RouterLink>
      </header>
      <div class="stat-row">
        <article class="stat-card" :class="{ 'stat-danger': calSummary.overdueUnconfirmed }">
          <span class="stat-label">逾期未确认</span>
          <strong class="stat-value">{{ calSummary.overdueUnconfirmed }}</strong>
        </article>
        <article class="stat-card" :class="{ 'stat-warn': calSummary.overdue }">
          <span class="stat-label">逾期（含已合格待重送）</span>
          <strong class="stat-value">{{ calSummary.overdue }}</strong>
        </article>
        <article class="stat-card stat-warn">
          <span class="stat-label">{{ DEFAULT_LEAD_DAYS }} 天内到期</span>
          <strong class="stat-value">{{ calSummary.dueSoon }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待计量确认总量</span>
          <strong class="stat-value">{{ calSummary.unconfirmed }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>仪器编号</th><th>检测线</th><th>到期日期</th><th>状态</th><th>提醒</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in calAttention" :key="item.id">
            <td>{{ item.仪器编号 }}</td>
            <td>{{ item.检测线 }}</td>
            <td>{{ item.到期日期 }}</td>
            <td>{{ item.状态 }}</td>
            <td>{{ item.text }}</td>
          </tr>
          <tr v-if="!calAttention.length">
            <td colspan="5" class="empty-state">暂无逾期或临期仪器</td>
          </tr>
        </tbody>
      </table>
      <p class="panel-note">与校准台账、灭菌验证清单同源，取回来的属同一份到期提醒。</p>
    </section>

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
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { DEFAULT_LEAD_DAYS, getReminders, reminderSummary } from '@/api/instrument-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const emptySummary = { total: 0, overdue: 0, overdueUnconfirmed: 0, dueSoon: 0, unconfirmed: 0 }
const calSummary = ref({ ...emptySummary })
const calAttention = computed(() =>
  getReminders(DEFAULT_LEAD_DAYS)
    .filter((item) => item.level !== 'normal')
    .sort((a, b) => a.daysLeft - b.daysLeft),
)

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  calSummary.value = reminderSummary(DEFAULT_LEAD_DAYS)
}

onMounted(refresh)
</script>
