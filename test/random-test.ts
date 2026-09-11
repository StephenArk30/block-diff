/**
 * 随机操作序列 round-trip 测试
 *
 * 流程：
 * 1. 随机生成一棵树（随机决定：完整树[单根、无 parentId] / 子树[1~3 个根、parentId 指向外部]，
 *    节点数 ∈ [minNodes, maxNodes]，默认 [300, 500]）；
 * 2. 随机生成 n 条编辑操作（n ∈ [minOps, maxOps]，默认 [50, 100]），
 *    逐条应用到树上（操作叠加，模拟真实编辑历史），得到新树；
 * 3. 调用 diffBlockTrees(旧树, 新树) 得到 action 序列；
 * 4. 用 applyOps 把 action 应用到旧树，断言结果与新树完全一致（结构 + 顺序 + props）。
 *
 * 关键设计：生成器使用独立的树模型（GenTree，有序孩子列表 + 直接 splice），
 * 不复用 applyOps —— 避免"新树的产生"与"校验的应用器"同源而互相掩盖 bug。
 */

import isEqual from 'lodash/isEqual';
import { diffBlockTrees, applyOps, type IBlock } from '../src/index';

export interface P {
  v: number;
  tag?: string;
}

export interface RandomTestOptions {
  seed: number;
  /** 每例随机操作条数下限，默认 50 */
  minOps?: number;
  /** 每例随机操作条数上限，默认 100 */
  maxOps?: number;
  /** 随机树节点数下限，默认 300 */
  minNodes?: number;
  /** 随机树节点数上限，默认 500 */
  maxNodes?: number;
}

export interface RandomCaseReport {
  seed: number;
  mode: 'complete' | 'subtree';
  treeSize: number;
  genOpCount: number;
  diffOpCount: number;
}

type Mode = 'complete' | 'subtree';

// ---------- 随机数工具（LCG，可复现） ----------

function makeRng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const randInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

function randomProps(rng: () => number): P {
  const p: P = { v: Math.floor(rng() * 100) };
  if (rng() < 0.3) p.tag = `t${Math.floor(rng() * 5)}`;
  return p;
}

// ---------- 独立树模型（生成器专用，与 applyOps 实现无关） ----------

class GenTree {
  /** id -> 节点数据；parentId 为 null 表示顶层，external 为顶层块的外部 parentId */
  private nodes = new Map<string, { props: P; parentId: string | null; external?: string }>();
  /** 父 -> 有序孩子列表；null 为顶层 */
  private childrenOf = new Map<string | null, string[]>();

  constructor() {
    this.childrenOf.set(null, []);
  }

  get size(): number {
    return this.nodes.size;
  }

  ids(): string[] {
    return [...this.nodes.keys()];
  }

  children(parent: string | null): string[] {
    return this.childrenOf.get(parent) ?? [];
  }

  parentIdOf(id: string): string | null {
    return this.nodes.get(id)!.parentId;
  }

  descendants(id: string): Set<string> {
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of this.childrenOf.get(cur) ?? []) {
        if (!out.has(c)) {
          out.add(c);
          stack.push(c);
        }
      }
    }
    return out;
  }

  add(id: string, parentId: string | null, props: P, before: string | undefined, external?: string): void {
    this.nodes.set(id, { props, parentId, external: parentId === null ? external : undefined });
    if (!this.childrenOf.has(id)) this.childrenOf.set(id, []);
    this.insert(this.childrenOf.get(parentId)!, id, before);
  }

  update(id: string, props: P): void {
    this.nodes.get(id)!.props = props;
  }

  /** 删除块及其整个子树 */
  delete(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const list = this.childrenOf.get(node.parentId)!;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of this.childrenOf.get(cur) ?? []) stack.push(c);
      this.childrenOf.delete(cur);
      this.nodes.delete(cur);
    }
  }

  /** 移动块（含子树）到新父下 before 之前（调用方保证不成环） */
  move(id: string, parentId: string | null, before: string | undefined, external?: string): void {
    const node = this.nodes.get(id)!;
    const oldList = this.childrenOf.get(node.parentId)!;
    const i = oldList.indexOf(id);
    if (i >= 0) oldList.splice(i, 1);
    node.parentId = parentId;
    node.external = parentId === null ? external : undefined;
    if (!this.childrenOf.has(parentId)) this.childrenOf.set(parentId, []);
    this.insert(this.childrenOf.get(parentId)!, id, before);
  }

  /** 序列化为扁平先序数组（diff 算法的输入格式） */
  serialize(): IBlock<P>[] {
    const out: IBlock<P>[] = [];
    const walk = (p: string | null): void => {
      for (const id of this.childrenOf.get(p) ?? []) {
        const n = this.nodes.get(id)!;
        out.push({ id, props: n.props, parentId: n.parentId ?? n.external });
        walk(id);
      }
    };
    walk(null);
    return out;
  }

  private insert(list: string[], id: string, before: string | undefined): void {
    const i = before != null ? list.indexOf(before) : -1;
    if (i >= 0) list.splice(i, 0, id);
    else list.push(id);
  }
}

// ---------- 随机操作生成 ----------

function genAddOp(rng: () => number, tree: GenTree, mode: Mode, id: string, forceRoot = false): string {
  // 目标父：子树模式下可落顶层（外部父）；完整树只能挂在已有块下（保持单根）
  const toTop = forceRoot || tree.size === 0 || (mode === 'subtree' && rng() < 0.25);
  let parentId: string | null;
  let external: string | undefined;
  if (toTop) {
    parentId = null;
    external = mode === 'subtree' ? (forceRoot || rng() < 0.5 ? 'ext' : undefined) : undefined;
  } else {
    parentId = pick(rng, tree.ids());
  }
  // 插入位置：目标父当前孩子中的随机锚点（70%）或追加（30%）
  const siblings = tree.children(parentId);
  const before = siblings.length > 0 && rng() < 0.7 ? pick(rng, siblings) : undefined;
  tree.add(id, parentId, randomProps(rng), before, external);
  const target = parentId ?? `(top${external ? ':' + external : ''})`;
  return `add ${id} -> ${target}${before ? ` before ${before}` : ' append'}`;
}

function tryGenDelete(rng: () => number, tree: GenTree, mode: Mode): string | null {
  const deletable = tree.ids().filter((id) => !(mode === 'complete' && tree.parentIdOf(id) === null));
  if (deletable.length === 0) return null; // 完整树的根不可删
  const id = pick(rng, deletable);
  tree.delete(id);
  return `delete ${id}`;
}

function tryGenUpdate(rng: () => number, tree: GenTree): string {
  const id = pick(rng, tree.ids());
  const props = randomProps(rng);
  tree.update(id, props);
  return `update ${id} -> v=${props.v}`;
}

function tryGenMove(rng: () => number, tree: GenTree, mode: Mode): string | null {
  const ids = tree.ids();
  if (ids.length === 0) return null;
  const x = pick(rng, ids);
  if (mode === 'complete' && tree.parentIdOf(x) === null) return null; // 完整树的根不可移
  // 目标父不能是 x 自身或其子孙（防环）
  const forbidden = tree.descendants(x);
  const blockTargets = ids.filter((id) => !forbidden.has(id));
  const toTop = mode === 'subtree' && rng() < 0.25;
  if (!toTop && blockTargets.length === 0) return null;
  let parentId: string | null;
  let external: string | undefined;
  if (toTop) {
    parentId = null;
    external = rng() < 0.5 ? 'ext' : undefined;
  } else {
    parentId = pick(rng, blockTargets);
  }
  const siblings = tree.children(parentId);
  const before = siblings.length > 0 && rng() < 0.7 ? pick(rng, siblings) : undefined;
  tree.move(x, parentId, before, external);
  const target = parentId ?? `(top${external ? ':' + external : ''})`;
  return `move ${x} -> ${target}${before ? ` before ${before}` : ' append'}`;
}

/** 生成一条合法操作并应用到树上；重试 20 次后兜底 add（永远合法） */
function genNextOp(rng: () => number, tree: GenTree, mode: Mode, addId: string): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const roll = rng();
    if (tree.size === 0 || roll < 0.3) return genAddOp(rng, tree, mode, addId);
    if (roll < 0.5) {
      const log = tryGenDelete(rng, tree, mode);
      if (log != null) return log;
    } else if (roll < 0.75) {
      return tryGenUpdate(rng, tree);
    } else {
      const log = tryGenMove(rng, tree, mode);
      if (log != null) return log;
    }
  }
  return genAddOp(rng, tree, mode, addId);
}

// ---------- 用例生成 ----------

export interface RandomCase {
  mode: Mode;
  oldBlocks: IBlock<P>[];
  newBlocks: IBlock<P>[];
  opLogs: string[];
  /** 随机编辑操作条数（不含初始建树的 add） */
  genOpCount: number;
}

export interface GenCaseOptions {
  minOps: number;
  maxOps: number;
  minNodes: number;
  maxNodes: number;
}

export function generateRandomCase(rng: () => number, opts: GenCaseOptions): RandomCase {
  const mode: Mode = rng() < 0.5 ? 'complete' : 'subtree';
  const tree = new GenTree();
  const opLogs: string[] = [];

  // 初始树：完整树（单根、无 parentId）/ 子树（1~3 个根、parentId 指向外部 'ext'）
  const initSize = randInt(rng, opts.minNodes, opts.maxNodes);
  const rootCount = Math.min(mode === 'complete' ? 1 : randInt(rng, 1, 3), initSize);
  for (let i = 0; i < initSize; i++) {
    opLogs.push(genAddOp(rng, tree, mode, `b${i}`, i < rootCount));
  }
  const oldBlocks = tree.serialize();

  // n 条随机编辑操作（逐条叠加）
  const n = randInt(rng, opts.minOps, opts.maxOps);
  for (let i = 0; i < n; i++) {
    opLogs.push(genNextOp(rng, tree, mode, `g${i}`));
  }
  const newBlocks = tree.serialize();

  return { mode, oldBlocks, newBlocks, opLogs, genOpCount: n };
}

// ---------- round-trip 校验 ----------

/** 规范化：先序 + 树内有效 parentId，便于深比较 */
function serializeForCompare(blocks: IBlock<P>[]): Array<{ id: string; parentId?: string; props: P }> {
  const ids = new Set(blocks.map((b) => b.id));
  const kids = new Map<string | null, IBlock<P>[]>();
  for (const b of blocks) {
    const p = b.parentId != null && ids.has(b.parentId) ? b.parentId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(b);
  }
  const out: Array<{ id: string; parentId?: string; props: P }> = [];
  const walk = (p: string | null): void => {
    for (const b of kids.get(p) ?? []) {
      out.push({ id: b.id, parentId: p ?? undefined, props: b.props });
      walk(b.id);
    }
  };
  walk(null);
  return out;
}

export function runRandomTestOnce(opts: RandomTestOptions): RandomCaseReport {
  const minOps = opts.minOps ?? 50;
  const maxOps = opts.maxOps ?? 100;
  const minNodes = opts.minNodes ?? 300;
  const maxNodes = opts.maxNodes ?? 500;
  if (minOps > maxOps) throw new Error(`minOps(${minOps}) 不能大于 maxOps(${maxOps})`);
  if (minNodes > maxNodes) throw new Error(`minNodes(${minNodes}) 不能大于 maxNodes(${maxNodes})`);
  const rng = makeRng(opts.seed);
  const { mode, oldBlocks, newBlocks, opLogs, genOpCount } = generateRandomCase(rng, {
    minOps,
    maxOps,
    minNodes,
    maxNodes,
  });

  const diffOps = diffBlockTrees(oldBlocks, newBlocks, { equal: (a, b) => isEqual(a, b) });
  const applied = applyOps(oldBlocks, diffOps);
  const got = serializeForCompare(applied);
  const want = serializeForCompare(newBlocks);

  if (!isEqual(got, want)) {
    throw new Error(
      [
        `随机 round-trip 测试失败 seed=${opts.seed} mode=${mode}`,
        `旧树(${oldBlocks.length}): ${JSON.stringify(oldBlocks)}`,
        `编辑操作日志(${opLogs.length} 条):`,
        ...opLogs.map((l, i) => `  ${i + 1}. ${l}`),
        `新树(${newBlocks.length}): ${JSON.stringify(newBlocks)}`,
        `diff 结果(${diffOps.length}): ${JSON.stringify(diffOps)}`,
        `应用结果(${applied.length}): ${JSON.stringify(applied)}`,
      ].join('\n')
    );
  }
  return { seed: opts.seed, mode, treeSize: newBlocks.length, genOpCount, diffOpCount: diffOps.length };
}

/** 批量运行：iterations 个用例，seed 从 baseSeed 递增 */
export function runRandomTests(
  iterations: number,
  opts: {
    minOps?: number;
    maxOps?: number;
    minNodes?: number;
    maxNodes?: number;
    baseSeed?: number;
  } = {}
): { passed: number; modes: { complete: number; subtree: number } } {
  const baseSeed = opts.baseSeed ?? Math.floor(Math.random() * 1_000_000_000);
  const modes = { complete: 0, subtree: 0 };
  for (let i = 0; i < iterations; i++) {
    const r = runRandomTestOnce({
      seed: baseSeed + i,
      minOps: opts.minOps,
      maxOps: opts.maxOps,
      minNodes: opts.minNodes,
      maxNodes: opts.maxNodes,
    });
    modes[r.mode]++;
  }
  return { passed: iterations, modes };
}
