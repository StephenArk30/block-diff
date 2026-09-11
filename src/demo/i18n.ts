/**
 * Demo 国际化（vue-i18n）
 * 默认语言：localStorage 记忆 > 浏览器语言 > 英文
 */

import { createI18n } from 'vue-i18n';

const STORAGE_KEY = 'block-diff-lang';

export const messages = {
  en: {
    title: 'Block Tree Diff',
    language: 'Language',
    nodeRange: 'Nodes',
    genTree: 'Generate Tree',
    actionCount: 'Actions',
    genActions: 'Generate Actions',
    diff: 'Diff',
    reset: 'Reset',
    oldTree: 'Old Tree',
    targetTree: 'Target New Tree',
    oldTreeHint: 'Click actions below to advance',
    oldTreePlaceholder: 'Set the node range and click "Generate Tree" to start',
    targetPlaceholder: 'Click "Generate Actions" to create the new tree',
    editStripTitle: 'Randomly generated editing actions ({n}) — used to build the new tree, click to replay',
    editStripTitleEmpty: 'Randomly generated editing actions — used to build the new tree',
    diffStripTitle: 'Diff actions ({n}) — click any action to advance the old tree to just after it',
    diffStripTitleEmpty: 'Diff actions',
    state0: 'Initial old tree',
    splitterTip: 'Drag to resize (double-click to reset)',
    opLabel: { add: 'Add', delete: 'Del', update: 'Upd', move: 'Move' },
    posBefore: 'before {id}',
    posEnd: 'end',
    subtree: '(with subtree)',
    labelDiff: 'Diff',
    labelEdit: 'Edit',
    status: {
      genTree: 'Generate a tree to start',
      genActions: 'Generate actions (random edits produce the new tree)',
      runDiff: 'Click Diff',
      playing: '{label} playing {cur}/{total}',
      done: '{label} finished {cur}/{total} — tree transformed',
      progress: '{label} progress {cur}/{total}, click actions below',
      noOps: 'No actions',
      identical: 'Trees are identical, no actions',
    },
    stripEmpty: '—',
    notDiffed: 'Not diffed yet',
  },
  zh: {
    title: 'Block Tree Diff',
    language: '语言',
    nodeRange: '节点范围',
    genTree: '随机生成树',
    actionCount: '动作数量',
    genActions: '随机生成动作',
    diff: 'Diff',
    reset: '重置',
    oldTree: '旧树',
    targetTree: '目标新树',
    oldTreeHint: '点击下方动作前进',
    oldTreePlaceholder: '填写节点范围，点击「随机生成树」开始',
    targetPlaceholder: '点击「随机生成动作」产生新树',
    editStripTitle: '随机生成的编辑动作（{n} 条）—— 用于产生新树，点击回放',
    editStripTitleEmpty: '随机生成的编辑动作 —— 用于产生新树',
    diffStripTitle: 'Diff 动作序列（{n} 条）—— 点击任意动作，旧树前进到该动作执行后',
    diffStripTitleEmpty: 'Diff 动作序列',
    state0: '初始旧树',
    splitterTip: '拖动调整两侧宽度（双击复位）',
    opLabel: { add: '增', delete: '删', update: '改', move: '移' },
    posBefore: '{id} 前',
    posEnd: '末尾',
    subtree: '（含子树）',
    labelDiff: 'Diff',
    labelEdit: '编辑',
    status: {
      genTree: '请生成树',
      genActions: '请生成动作（随机编辑得到新树）',
      runDiff: '请点击 Diff',
      playing: '{label}播放中 {cur}/{total}',
      done: '{label}动作完成 {cur}/{total}，已变换为新树',
      progress: '{label}进度 {cur}/{total}，点击下方动作前进',
      noOps: '无动作',
      identical: '两棵树相同，无动作',
    },
    stripEmpty: '—',
    notDiffed: '尚未 Diff',
  },
};

function detectLocale(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* ignore */
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages,
});

export function persistLocale(locale: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
