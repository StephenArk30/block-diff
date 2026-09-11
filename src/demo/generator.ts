/**
 * Demo 随机数据生成器：
 * - randomTree: 随机生成一棵完整树（单根、无 parentId），value 为随机字符串
 * - randomEdits: 随机生成一批编辑动作（add/delete/update/move）逐条应用到旧树，得到新树
 */

import { applyOps, type IBlock, type DiffOp } from '../index';
import { faker } from '@faker-js/faker/locale/en';

export type P = string;

const randInt = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 随机生成有意义的英文词句（1~4 个词，faker 真实词库） */
export function randomValue(): string {
  const r = Math.random();
  if (r < 0.25) return faker.word.noun();
  if (r < 0.55) return `${faker.word.adjective()} ${faker.word.noun()}`;
  if (r < 0.85) return `the ${faker.word.adjective()} ${faker.word.noun()}`;
  return `${faker.word.verb()} the ${faker.word.adjective()} ${faker.word.noun()}`;
}

/** 随机生成一棵完整树（单根，其余块随机挂到已有块下） */
export function randomTree(minNodes: number, maxNodes: number): IBlock<P>[] {
  const n = Math.max(1, randInt(minNodes, maxNodes));
  const blocks: IBlock<P>[] = [{ id: 'root', value: randomValue() }];
  for (let i = 1; i < n; i++) {
    blocks.push({ id: `b${i}`, value: randomValue(), parentId: pick(blocks).id });
  }
  return blocks;
}

interface Snap {
  rootIds: Set<string>;
  childrenOf: Map<string | null, IBlock<P>[]>;
  all: IBlock<P>[];
}

function snap(blocks: IBlock<P>[]): Snap {
  const ids = new Set(blocks.map((b) => b.id));
  const childrenOf = new Map<string | null, IBlock<P>[]>();
  const rootIds = new Set<string>();
  for (const b of blocks) {
    const p = b.parentId != null && ids.has(b.parentId) ? b.parentId : null;
    if (p === null) rootIds.add(b.id);
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(b);
  }
  return { rootIds, childrenOf, all: blocks };
}

function descendantsOf(st: Snap, id: string): Set<string> {
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of st.childrenOf.get(cur) ?? []) {
      if (!out.has(c.id)) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

function genAdd(st: Snap, id: string): DiffOp<P> {
  const parentId = pick(st.all).id;
  const siblings = st.childrenOf.get(parentId) ?? [];
  const before = siblings.length > 0 && Math.random() < 0.7 ? pick(siblings).id : undefined;
  return { type: 'add', id, parentId, before, block: { id, value: randomValue(), parentId } };
}

function genUpdate(st: Snap): DiffOp<P> {
  const b = pick(st.all);
  let v = randomValue();
  for (let i = 0; i < 5 && v === b.value; i++) v = randomValue();
  return { type: 'update', id: b.id, value: v };
}

function genDelete(st: Snap): DiffOp<P> | null {
  const candidates = st.all.filter((b) => !st.rootIds.has(b.id));
  if (candidates.length === 0) return null;
  return { type: 'delete', id: pick(candidates).id };
}

function genMove(st: Snap): DiffOp<P> | null {
  const x = pick(st.all);
  if (st.rootIds.has(x.id)) return null; // 根挂在任何人下面都会成环
  const forbidden = descendantsOf(st, x.id);
  const targets = st.all.filter((b) => !forbidden.has(b.id));
  if (targets.length === 0) return null;
  const parentId = pick(targets).id;
  const siblings = st.childrenOf.get(parentId) ?? [];
  const before = siblings.length > 0 && Math.random() < 0.7 ? pick(siblings).id : undefined;
  return { type: 'move', id: x.id, parentId, before };
}

function genEditOp(cur: IBlock<P>[], addId: string): DiffOp<P> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const st = snap(cur);
    const roll = Math.random();
    if (roll < 0.3) return genAdd(st, addId);
    if (roll < 0.5) {
      const op = genDelete(st);
      if (op) return op;
    } else if (roll < 0.75) {
      return genUpdate(st);
    } else {
      const op = genMove(st);
      if (op) return op;
    }
  }
  return genAdd(snap(cur), addId); // add 永远合法，兜底
}

/** 随机生成 n ∈ [minOps, maxOps] 条编辑动作并逐条应用，返回新树 */
export function randomEdits(
  oldTree: IBlock<P>[],
  minOps: number,
  maxOps: number
): { editOps: DiffOp<P>[]; newTree: IBlock<P>[] } {
  const n = Math.max(0, randInt(minOps, maxOps));
  const editOps: DiffOp<P>[] = [];
  let cur = oldTree;
  let counter = 0;
  for (let i = 0; i < n; i++) {
    const op = genEditOp(cur, `g${counter}`);
    if (op.type === 'add') counter++;
    editOps.push(op);
    cur = applyOps(cur, [op]);
  }
  return { editOps, newTree: cur };
}
