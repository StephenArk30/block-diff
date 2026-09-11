<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { diffBlockTrees, applyOps, type IBlock, type DiffOp } from '../index';
import { randomTree, randomEdits, type P } from './generator';
import { computeLayout, NODE_W, NODE_H } from './layout';
import { persistLocale } from './i18n';

const { t, locale } = useI18n();
watch(locale, (l) => persistLocale(String(l)));

type Effect = { kind: 'update' | 'move'; ids: Set<string> };
/** 当前回放的序列：随机编辑动作（edit）/ diff 动作（diff） */
type Mode = 'edit' | 'diff';

// ---------- 表单 ----------
const minNodes = ref(3);
const maxNodes = ref(10);
const minActions = ref(5);
const maxActions = ref(10);

// ---------- 数据 ----------
const oldTree = ref<IBlock<P>[] | null>(null);
const newTree = ref<IBlock<P>[] | null>(null);
/** 生成新树所用的随机编辑动作（可回放） */
const editOps = ref<DiffOp<P>[]>([]);
const diffOps = ref<DiffOp<P>[] | null>(null);

// ---------- 播放状态 ----------
const mode = ref<Mode>('diff');
const step = ref(-1); // 已应用到的动作下标，-1 = 状态 0（初始旧树）
const blocks = ref<IBlock<P>[]>([]);
const effect = ref<Effect | null>(null);
const playing = ref(false);

let playToken = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const nn = (v: number, d: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : d);
function rangeOf(lo: number, hi: number): [number, number] {
  const a = nn(lo, 1);
  const b = nn(hi, 1);
  return a <= b ? [a, b] : [b, a];
}

function resetPlayback() {
  playToken++;
  playing.value = false;
  effect.value = null;
  mode.value = 'diff';
  step.value = -1;
  blocks.value = oldTree.value ?? [];
}

function genTree() {
  const [lo, hi] = rangeOf(minNodes.value, maxNodes.value);
  oldTree.value = randomTree(lo, hi);
  newTree.value = null;
  editOps.value = [];
  diffOps.value = null;
  resetPlayback();
}

function genActions() {
  if (!oldTree.value) return;
  const [lo, hi] = rangeOf(minActions.value, maxActions.value);
  const r = randomEdits(oldTree.value, lo, hi);
  newTree.value = r.newTree;
  editOps.value = r.editOps;
  diffOps.value = null;
  resetPlayback();
}

function doDiff() {
  if (!oldTree.value || !newTree.value) return;
  diffOps.value = diffBlockTrees(oldTree.value, newTree.value, { equal: (a, b) => a === b });
  resetPlayback();
}

// ---------- 动作应用与播放 ----------

function descendantIds(list: IBlock<P>[], rootId: string): string[] {
  const ids = new Set(list.map((b) => b.id));
  const kids = new Map<string, IBlock<P>[]>();
  for (const b of list) {
    const p = b.parentId != null && ids.has(b.parentId) ? b.parentId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(b);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    for (const c of kids.get(stack.pop()!) ?? []) {
      out.push(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/** 应用序列 ops 中的第 i 个动作并标记闪烁效果 */
function applyOpAt(ops: DiffOp<P>[], i: number): void {
  const op = ops[i];
  if (op.type === 'update') {
    effect.value = { kind: 'update', ids: new Set([op.id]) };
    blocks.value = applyOps(blocks.value, [op]);
  } else if (op.type === 'move') {
    const next = applyOps(blocks.value, [op]);
    // 移动的整棵子树在滑动过程中闪蓝
    effect.value = { kind: 'move', ids: new Set([op.id, ...descendantIds(next, op.id)]) };
    blocks.value = next;
  } else {
    // add / delete 的闪烁由 TransitionGroup 的 enter / leave 过渡承担
    effect.value = null;
    blocks.value = applyOps(blocks.value, [op]);
  }
  step.value = i;
}

/**
 * 点击动作（回放）：
 * - target = -1 表示状态 0（回到初始旧树）；
 * - 切换序列（edit ↔ diff）时，清掉当前应用状态，从旧树重新开始应用；
 * - 同序列向后点 = 瞬时重建；向前点 = 逐条动画播放（可被新点击打断）。
 */
async function playTo(m: Mode, target: number): Promise<void> {
  const ops = m === 'diff' ? diffOps.value : editOps.value;
  if (!ops) return;
  if (m !== mode.value) {
    playToken++;
    playing.value = false;
    effect.value = null;
    mode.value = m;
    step.value = -1;
    blocks.value = oldTree.value ?? [];
  }
  if (target <= step.value) {
    jumpTo(target);
    return;
  }
  const token = ++playToken;
  playing.value = true;
  while (step.value < target) {
    if (token !== playToken) return;
    applyOpAt(ops, step.value + 1);
    await sleep(ops[step.value].type === 'delete' ? 1000 : 850);
  }
  if (token === playToken) playing.value = false;
}

/** 向后跳转 / 重置：瞬时重建，无动画 */
function jumpTo(target: number): void {
  playToken++;
  playing.value = false;
  effect.value = null;
  const ops = mode.value === 'diff' ? diffOps.value : editOps.value;
  if (!ops || target < 0) {
    step.value = -1;
    blocks.value = oldTree.value ?? [];
    return;
  }
  step.value = target;
  blocks.value = applyOps(oldTree.value!, ops.slice(0, target + 1));
}

// ---------- 视图（传统树形布局） ----------

interface NodeView {
  id: string;
  value: string;
  left: number;
  top: number;
  cls: string;
}
interface EdgeView {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface TreeView {
  nodes: NodeView[];
  edges: EdgeView[];
  width: number;
  height: number;
}

const emptyView: TreeView = { nodes: [], edges: [], width: 0, height: 0 };

function buildView(list: IBlock<P>[], eff: Effect | null): TreeView {
  const { pos, width, height } = computeLayout(list);
  const nodes: NodeView[] = list.map((b) => {
    const p = pos.get(b.id) ?? { x: 0, y: 0 };
    return {
      id: b.id,
      value: b.props,
      left: Math.round(p.x - NODE_W / 2),
      top: p.y,
      cls: eff && eff.ids.has(b.id) ? (eff.kind === 'update' ? 'flash-update' : 'flash-move') : '',
    };
  });
  const edges: EdgeView[] = [];
  for (const b of list) {
    const c = pos.get(b.id);
    const p = b.parentId != null ? pos.get(b.parentId) : undefined;
    if (c && p) edges.push({ id: b.id, x1: p.x, y1: p.y + NODE_H, x2: c.x, y2: c.y });
  }
  return { nodes, edges, width, height };
}

/** 左侧动画树 */
const view = computed(() => buildView(blocks.value, effect.value));
/** 右侧目标新树（静态） */
const newView = computed(() => (newTree.value ? buildView(newTree.value, null) : emptyView));

// ---------- 动作描述 ----------

function describeOp(op: DiffOp<P>): string {
  const pos =
    op.type === 'add' || op.type === 'move'
      ? op.before
        ? t('posBefore', { id: op.before })
        : t('posEnd')
      : '';
  switch (op.type) {
    case 'add':
      return `${op.id} → ${op.parentId} · ${pos}`;
    case 'delete':
      return `${op.id} ${t('subtree')}`;
    case 'update':
      return `${op.id} = "${op.props}"`;
    case 'move':
      return `${op.id} → ${op.parentId} · ${pos}`;
  }
}

const statusText = computed(() => {
  if (!oldTree.value) return t('status.genTree');
  if (!newTree.value) return t('status.genActions');
  if (mode.value === 'diff' && !diffOps.value) return t('status.runDiff');
  const ops = mode.value === 'diff' ? diffOps.value : editOps.value;
  const label = mode.value === 'diff' ? t('labelDiff') : t('labelEdit');
  const n = ops?.length ?? 0;
  if (playing.value) return t('status.playing', { label, cur: step.value + 1, total: n });
  if (n === 0) return mode.value === 'diff' ? t('status.identical') : t('status.noOps');
  if (step.value >= n - 1) return t('status.done', { label, cur: n, total: n });
  return t('status.progress', { label, cur: step.value + 1, total: n });
});

// 播放时当前序列的动作 chips 自动滚动跟随（横向）
const editChipsEl = ref<HTMLElement | null>(null);
const diffChipsEl = ref<HTMLElement | null>(null);
watch(step, async (s) => {
  const el = mode.value === 'diff' ? diffChipsEl.value : editChipsEl.value;
  if (!el || s < 0) return;
  await nextTick();
  el.querySelector(`[data-idx="${s}"]`)?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'smooth',
  });
});

// ---------- 左右分栏拖拽（分隔条） ----------
const leftPct = ref(50); // 左侧面板宽度百分比
const dragging = ref(false);

function onSplitterDown(e: PointerEvent) {
  e.preventDefault();
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onSplitterMove(e: PointerEvent) {
  if (!dragging.value) return;
  const rect = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
  if (!rect) return;
  leftPct.value = Math.min(85, Math.max(15, ((e.clientX - rect.left) / rect.width) * 100));
}
function onSplitterUp() {
  dragging.value = false;
}
</script>

<template>
  <div class="app" :class="{ 'col-resizing': dragging }">
    <header class="toolbar">
      <h1 class="title">{{ t('title') }}</h1>
      <div class="group">
        <label>{{ t('nodeRange') }}</label>
        <input v-model.number="minNodes" type="number" min="1" />
        <span class="tilde">~</span>
        <input v-model.number="maxNodes" type="number" min="1" />
        <button class="btn" :disabled="playing" @click="genTree">{{ t('genTree') }}</button>
      </div>
      <div class="group">
        <label>{{ t('actionCount') }}</label>
        <input v-model.number="minActions" type="number" min="0" />
        <span class="tilde">~</span>
        <input v-model.number="maxActions" type="number" min="0" />
        <button class="btn" :disabled="!oldTree || playing" @click="genActions">{{ t('genActions') }}</button>
      </div>
      <div class="group">
        <button class="btn primary" :disabled="!oldTree || !newTree || playing" @click="doDiff">{{ t('diff') }}</button>
        <button class="btn" :disabled="step < 0" @click="playTo(mode, -1)">{{ t('reset') }}</button>
      </div>
      <div class="group lang-group">
        <select v-model="locale" class="lang-select" :aria-label="t('language')">
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div class="status">{{ statusText }}</div>
    </header>

    <main class="trees">
      <!-- 左：旧树（动画） -->
      <section class="panel" :style="{ flexBasis: leftPct + '%' }">
        <div class="panel-head">
          {{ t('oldTree') }}<span class="sub">{{ t('oldTreeHint') }}</span>
        </div>
        <div class="scroll">
          <div v-if="!oldTree" class="placeholder">{{ t('oldTreePlaceholder') }}</div>
          <div
            v-else
            class="tree-wrap"
            :style="{ width: view.width + 'px', height: view.height + 'px' }"
          >
            <svg class="edges" :width="view.width" :height="view.height">
              <TransitionGroup name="edge" tag="g">
                <line
                  v-for="e in view.edges"
                  :key="e.id"
                  :x1="e.x1"
                  :y1="e.y1"
                  :x2="e.x2"
                  :y2="e.y2"
                />
              </TransitionGroup>
            </svg>
            <TransitionGroup name="node">
              <div
                v-for="nd in view.nodes"
                :key="nd.id"
                class="node"
                :class="nd.cls"
                :style="{ left: nd.left + 'px', top: nd.top + 'px', width: NODE_W + 'px' }"
              >
                <span class="node-id">{{ nd.id }}</span>
                <span class="node-value" :title="nd.value">{{ nd.value }}</span>
              </div>
            </TransitionGroup>
          </div>
        </div>
      </section>

      <!-- 可拖拽分隔条 -->
      <div
        class="splitter"
        :class="{ dragging }"
        :title="t('splitterTip')"
        @pointerdown="onSplitterDown"
        @pointermove="onSplitterMove"
        @pointerup="onSplitterUp"
        @pointercancel="onSplitterUp"
        @dblclick="leftPct = 50"
      ></div>

      <!-- 右：目标新树（静态） -->
      <section class="panel target">
        <div class="panel-head">{{ t('targetTree') }}</div>
        <div class="scroll">
          <div v-if="!newTree" class="placeholder">{{ t('targetPlaceholder') }}</div>
          <div
            v-else
            class="tree-wrap"
            :style="{ width: newView.width + 'px', height: newView.height + 'px' }"
          >
            <svg class="edges" :width="newView.width" :height="newView.height">
              <line
                v-for="e in newView.edges"
                :key="e.id"
                :x1="e.x1"
                :y1="e.y1"
                :x2="e.x2"
                :y2="e.y2"
              />
            </svg>
            <div
              v-for="nd in newView.nodes"
              :key="nd.id"
              class="node"
              :style="{ left: nd.left + 'px', top: nd.top + 'px', width: NODE_W + 'px' }"
            >
              <span class="node-id">{{ nd.id }}</span>
              <span class="node-value" :title="nd.value">{{ nd.value }}</span>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="strips">
      <!-- 上：随机生成的编辑动作（可回放） -->
      <section class="strip">
        <div class="strip-title">
          {{
            editOps.length
              ? t('editStripTitle', { n: editOps.length })
              : t('editStripTitleEmpty')
          }}
        </div>
        <div ref="editChipsEl" class="chips">
          <button class="chip btn state0" :class="{ active: step < 0 }" @click="playTo('edit', -1)">
            <span class="c-idx">0</span>
            <span class="c-desc">{{ t('state0') }}</span>
          </button>
          <button
            v-for="(op, i) in editOps"
            :key="i"
            :data-idx="i"
            class="chip btn"
            :class="{ done: mode === 'edit' && i <= step, active: mode === 'edit' && i === step }"
            @click="playTo('edit', i)"
          >
            <span class="c-idx">{{ i + 1 }}</span>
            <span class="badge" :class="`t-${op.type}`">{{ t(`opLabel.${op.type}`) }}</span>
            <span class="c-desc">{{ describeOp(op) }}</span>
          </button>
          <span v-if="editOps.length === 0" class="strip-empty">{{ t('stripEmpty') }}</span>
        </div>
      </section>

      <!-- 下：diff 动作序列（可回放） -->
      <section class="strip">
        <div class="strip-title">
          {{
            diffOps && diffOps.length
              ? t('diffStripTitle', { n: diffOps.length })
              : t('diffStripTitleEmpty')
          }}
        </div>
        <div ref="diffChipsEl" class="chips">
          <template v-if="diffOps">
            <button class="chip btn state0" :class="{ active: step < 0 }" @click="playTo('diff', -1)">
              <span class="c-idx">0</span>
              <span class="c-desc">{{ t('state0') }}</span>
            </button>
            <button
              v-for="(op, i) in diffOps"
              :key="i"
              :data-idx="i"
              class="chip btn"
              :class="{ done: mode === 'diff' && i <= step, active: mode === 'diff' && i === step }"
              @click="playTo('diff', i)"
            >
              <span class="c-idx">{{ i + 1 }}</span>
              <span class="badge" :class="`t-${op.type}`">{{ t(`opLabel.${op.type}`) }}</span>
              <span class="c-desc">{{ describeOp(op) }}</span>
            </button>
            <span v-if="diffOps.length === 0" class="strip-empty">{{ t('status.identical') }}</span>
          </template>
          <span v-else class="strip-empty">{{ t('notDiffed') }}</span>
        </div>
      </section>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.app.col-resizing,
.app.col-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}

/* ---------- 工具栏 ---------- */
.toolbar {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  flex: none;
}
.title {
  font-size: 15px;
  margin: 0;
  color: #4f46e5;
  white-space: nowrap;
}
.group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.group label {
  font-size: 13px;
  color: #374151;
  white-space: nowrap;
}
.tilde {
  color: #9ca3af;
}
input[type='number'] {
  width: 58px;
  padding: 5px 6px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
}
.lang-group {
  margin-left: auto;
}
.lang-select {
  padding: 5px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
  color: #374151;
  cursor: pointer;
}
.lang-select:hover {
  border-color: #4f46e5;
}
.btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #374151;
  white-space: nowrap;
}
.btn:hover:not(:disabled) {
  border-color: #4f46e5;
  color: #4f46e5;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn.primary {
  background: #4f46e5;
  border-color: #4f46e5;
  color: #fff;
}
.btn.primary:hover:not(:disabled) {
  background: #4338ca;
  color: #fff;
}
.status {
  font-size: 13px;
  font-weight: 500;
  color: #4f46e5;
  white-space: nowrap;
}

/* ---------- 树面板（左旧树 | 可拖分隔条 | 右目标新树） ---------- */
.trees {
  flex: 1;
  display: flex;
  min-height: 0;
}
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  flex: 0 0 auto; /* 宽度由分隔条控制（flexBasis 内联指定） */
  background: #fff;
}
.panel.target {
  flex: 1 1 0%;
}
.splitter {
  flex: none;
  width: 6px;
  background: #e5e7eb;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}
.splitter:hover,
.splitter.dragging {
  background: #a5b4fc;
}
.panel-head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  border-bottom: 1px solid #f3f4f6;
}
.panel-head .sub {
  font-size: 11.5px;
  font-weight: 400;
  color: #9ca3af;
}
.scroll {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
.tree-wrap {
  position: relative;
  margin: 0 auto;
}
.placeholder {
  color: #9ca3af;
  font-size: 13px;
  text-align: center;
  padding: 32px 12px;
}

/* 节点与连线 */
.edges {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
  pointer-events: none;
}
.edges line {
  stroke: #cbd5e1;
  stroke-width: 1.5;
}
.node {
  position: absolute;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  font-size: 12px;
  box-sizing: border-box;
}
.node-id {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  color: #6b7280;
  background: #f3f4f6;
  border-radius: 4px;
  padding: 1px 5px;
}
.node-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #111827;
}

/* ---------- 底部动作条（单行，横向滚动） ---------- */
.strips {
  flex: none;
  background: #fff;
  border-top: 1px solid #e5e7eb;
}
.strip {
  padding: 8px 14px 6px;
}
.strip + .strip {
  border-top: 1px dashed #e5e7eb;
}
.strip-title {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 6px;
}
.chips {
  display: flex;
  flex-wrap: nowrap; /* 不换行：所有 chip 单行排列，超出出横向滚动条 */
  overflow-x: auto;
  gap: 6px;
  padding-bottom: 4px;
}
.chips::-webkit-scrollbar {
  height: 8px;
}
.chips::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px 3px 5px;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}
.chip.btn {
  cursor: pointer;
}
.chip.btn:hover {
  border-color: #4f46e5;
}
.chip.state0 .c-idx {
  background: #9ca3af;
  color: #fff;
}
.chip.done {
  opacity: 0.5;
}
.chip.done .c-idx {
  background: #4f46e5;
  color: #fff;
}
.chip.active {
  background: #eef2ff;
  box-shadow: inset 0 0 0 1px #c7d2fe;
}
.c-idx {
  flex: none;
  width: 20px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #e5e7eb;
  color: #374151;
  font-size: 10.5px;
}
.badge {
  flex: none;
  font-size: 10.5px;
  line-height: 1;
  padding: 2.5px 6px;
  border-radius: 999px;
  color: #fff;
}
.t-add { background: #22c55e; }
.t-delete { background: #ef4444; }
.t-update { background: #f59e0b; }
.t-move { background: #3b82f6; }
.c-desc {
  color: #374151;
  white-space: nowrap;
}
.strip-empty {
  color: #9ca3af;
  font-size: 12px;
  white-space: nowrap;
}

/* ---------- 动画 ----------
   闪烁均以「背景色脉冲 + 描边」实现，透明度始终保持 1，避免晃眼。
   只有新增的淡入起点与删除的消散终点使用透明度过渡。
   节点为绝对定位，left/top 变化由 TransitionGroup 的 FLIP（transform）平滑过渡；
   连线（SVG line）同样套 TransitionGroup，端点变化也走 FLIP 滑动。 */

.node-move,
.edge-move {
  transition: transform 0.65s cubic-bezier(0.4, 0, 0.2, 1);
}
.edge-enter-active,
.edge-leave-active {
  transition: opacity 0.45s;
}
.edge-enter-from,
.edge-leave-to {
  opacity: 0;
}

/* 修改：黄色闪烁（两次脉冲） */
@keyframes flash-update {
  0%, 100% { background: #ffffff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
  30%, 70% { background: #fef3c7; box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.5); }
  50% { background: #fde68a; }
}
.flash-update {
  animation: flash-update 0.8s ease 2;
}

/* 移动：蓝色闪烁（配合 FLIP 滑动） */
@keyframes flash-move {
  0%, 100% { background: #ffffff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
  25%, 75% { background: #dbeafe; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5); }
  50% { background: #bfdbfe; }
}
.flash-move {
  animation: flash-move 0.9s ease;
}

/* 新增：绿色闪烁 + 淡入放大 */
.node-enter-active {
  animation: flash-add 0.85s ease;
}
@keyframes flash-add {
  0% { opacity: 0; transform: scale(0.9); background: #dcfce7; }
  25% { opacity: 1; background: #bbf7d0; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.5); }
  50% { background: #dcfce7; }
  75% { background: #bbf7d0; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.5); }
  100% { background: #ffffff; transform: scale(1); }
}

/* 删除：红色闪烁后消散 */
.node-leave-active {
  animation: flash-del 0.95s ease forwards;
}
@keyframes flash-del {
  0% { background: #fee2e2; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.5); }
  30% { background: #fecaca; }
  55% { background: #fee2e2; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.5); }
  100% { background: #fee2e2; opacity: 0; transform: scale(0.92); }
}
</style>
