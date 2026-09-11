/**
 * 传统树形布局（tidy tree）：
 * 根在最上方，深度 1、2、3… 逐级向下；叶子按"单位宽度"等距分布，
 * 父节点水平居中于其首尾孩子之间。子树的槽位区间连续且互不重叠，保证节点不碰撞。
 */

import type { IBlock } from '../index';

export const NODE_W = 104; // 节点盒宽
export const NODE_H = 34; // 节点盒高
export const X_STEP = 114; // 兄弟槽位水平间距（同级节点间隙 = X_STEP - NODE_W = 10px）
export const Y_STEP = 88; // 层级垂直间距
export const PAD = 16; // 画布内边距

export interface Pt {
  x: number; // 节点中心 x
  y: number; // 节点顶部 y
}

export interface LayoutResult {
  pos: Map<string, Pt>;
  width: number;
  height: number;
}

export function computeLayout<P>(blocks: IBlock<P>[]): LayoutResult {
  const ids = new Set(blocks.map((b) => b.id));
  const childrenOf = new Map<string | null, string[]>();
  for (const b of blocks) {
    const p = b.parentId != null && ids.has(b.parentId) ? b.parentId : null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(b.id);
  }

  const pos = new Map<string, Pt>();
  let cursor = 0; // 全局叶子槽位游标
  let maxDepth = 0;

  const place = (id: string, depth: number): void => {
    if (depth > maxDepth) maxDepth = depth;
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      pos.set(id, { x: PAD + NODE_W / 2 + cursor * X_STEP, y: PAD + depth * Y_STEP });
      cursor++;
      return;
    }
    for (const k of kids) place(k, depth + 1);
    const first = pos.get(kids[0])!;
    const last = pos.get(kids[kids.length - 1])!;
    pos.set(id, { x: (first.x + last.x) / 2, y: PAD + depth * Y_STEP });
  };

  for (const r of childrenOf.get(null) ?? []) place(r, 0);

  const width = Math.max(PAD * 2 + NODE_W, PAD * 2 + NODE_W + (cursor - 1) * X_STEP);
  const height = PAD * 2 + NODE_H + maxDepth * Y_STEP;
  return { pos, width, height };
}
