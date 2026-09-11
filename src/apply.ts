/**
 * DiffOp 应用器：把 diffBlockTrees 产出的操作序列应用到旧树上，得到新树。
 * 主要用于测试验证（round-trip property），同时说明各 op 的语义。
 *
 * 应用语义：
 * - update: 按 id 更新 props
 * - move:   把 block（含子树）从当前位置摘出，插入到 parentId 下 before 之前（before 缺省追加到末尾）
 * - delete: 按 id 删除该 block（含其子树）
 * - add:    在 parentId 下 before 之前插入新 block（before 缺省追加到末尾）
 *
 * 注意：
 * - 必须按 diff 输出顺序应用（update → move/add 交错 → delete）；
 * - parentId 指向树外部（子树 diff 场景，如 'ext'）时视为顶层，block 保留该外部 parentId。
 */

import type { DiffOp, IBlock } from './diff';
import { VIRTUAL_ROOT_ID } from './diff';

interface TNode<T> {
  block: IBlock<T>;
  children: TNode<T>[];
}

export function applyOps<T>(oldBlocks: IBlock<T>[], ops: DiffOp<T>[]): IBlock<T>[] {
  const root: TNode<T> = { block: { id: VIRTUAL_ROOT_ID, props: null as T }, children: [] };
  const nodes = new Map<string, TNode<T>>();

  /** 解析目标父：树内块 → 该块；VIRTUAL_ROOT 或外部 id → 虚拟根（记录外部 id） */
  const resolveParent = (pid: string): { parent: TNode<T>; external: string | null } => {
    if (pid === VIRTUAL_ROOT_ID) return { parent: root, external: null };
    const p = nodes.get(pid);
    if (p) return { parent: p, external: null };
    return { parent: root, external: pid };
  };

  const insertBefore = (parent: TNode<T>, node: TNode<T>, before: string | undefined, external: string | null): void => {
    node.block.parentId = parent === root ? (external ?? undefined) : parent.block.id;
    if (before == null) {
      parent.children.push(node);
      return;
    }
    const idx = parent.children.findIndex((c) => c.block.id === before);
    if (idx < 0) throw new Error(`applyOps: anchor not found: ${before}`);
    parent.children.splice(idx, 0, node);
  };

  const detach = (node: TNode<T>): void => {
    const removeRec = (siblings: TNode<T>[]): boolean => {
      const idx = siblings.indexOf(node);
      if (idx >= 0) {
        siblings.splice(idx, 1);
        return true;
      }
      return siblings.some((s) => removeRec(s.children));
    };
    if (!removeRec(root.children)) throw new Error(`applyOps: node not found: ${node.block.id}`);
  };

  // ---------- 初始化旧树 ----------
  {
    const nodeOf = new Map<string, TNode<T>>();
    for (const b of oldBlocks) {
      if (nodeOf.has(b.id)) throw new Error(`applyOps: duplicate id: ${b.id}`);
      nodeOf.set(b.id, { block: { ...b }, children: [] });
    }
    for (const b of oldBlocks) {
      const node = nodeOf.get(b.id)!;
      nodes.set(b.id, node);
      if (b.parentId != null && nodeOf.has(b.parentId)) {
        nodeOf.get(b.parentId)!.children.push(node);
      } else {
        root.children.push(node); // 顶层（含外部 parentId）
      }
    }
  }

  // ---------- 依序应用 ops ----------
  for (const op of ops) {
    switch (op.type) {
      case 'update': {
        const node = nodes.get(op.id);
        if (!node) throw new Error(`applyOps: update target not found: ${op.id}`);
        node.block.props = op.props;
        break;
      }
      case 'move': {
        const node = nodes.get(op.id);
        if (!node) throw new Error(`applyOps: move target not found: ${op.id}`);
        const { parent, external } = resolveParent(op.parentId);
        detach(node);
        insertBefore(parent, node, op.before, external);
        break;
      }
      case 'delete': {
        const node = nodes.get(op.id);
        if (!node) throw new Error(`applyOps: delete target not found: ${op.id}`);
        detach(node);
        const removeIds = (n: TNode<T>): void => {
          nodes.delete(n.block.id);
          for (const c of n.children) removeIds(c);
        };
        removeIds(node);
        break;
      }
      case 'add': {
        if (nodes.has(op.id)) throw new Error(`applyOps: add duplicate id: ${op.id}`);
        const { parent, external } = resolveParent(op.parentId);
        const node: TNode<T> = { block: { ...op.block }, children: [] };
        nodes.set(op.id, node);
        insertBefore(parent, node, op.before, external);
        break;
      }
    }
  }

  // ---------- 序列化为扁平数组（先序） ----------
  const out: IBlock<T>[] = [];
  const emit = (n: TNode<T>): void => {
    for (const c of n.children) {
      out.push(c.block);
      emit(c);
    }
  };
  emit(root);
  return out;
}
