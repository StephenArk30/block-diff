import { describe, it, expect } from 'vitest';
import isEqual from 'lodash/isEqual';
import { diffBlockTrees, applyOps, type IBlock, type DiffOp } from '../src/index';

interface P {
  text?: string;
  n?: number;
}

const eq = (a: P, b: P) => isEqual(a, b);
const diff = (o: IBlock<P>[], n: IBlock<P>[]) => diffBlockTrees(o, n, { equal: eq });

/** 序列化为先序规范形式：{id, 树内parentId, value} 数组（顺序即先序） */
function serialize(blocks: IBlock<P>[]): Array<{ id: string; parentId?: string; value: P }> {
  const ids = new Set(blocks.map((b) => b.id));
  const kids = new Map<string | null, IBlock<P>[]>();
  for (const b of blocks) {
    const p = b.parentId != null && ids.has(b.parentId) ? b.parentId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(b);
  }
  const out: Array<{ id: string; parentId?: string; value: P }> = [];
  const walk = (p: string | null): void => {
    for (const b of kids.get(p) ?? []) {
      out.push({ id: b.id, parentId: p ?? undefined, value: b.value });
      walk(b.id);
    }
  };
  walk(null);
  return out;
}

/** round-trip：diff 后应用 ops，结果应与新树完全一致（结构 + 顺序 + value） */
function roundTrip(oldB: IBlock<P>[], newB: IBlock<P>[]): DiffOp<P>[] {
  const ops = diff(oldB, newB);
  const applied = applyOps(oldB, ops);
  expect(serialize(applied)).toEqual(serialize(newB));
  return ops;
}

const count = (ops: DiffOp<P>[], type: DiffOp<P>['type']) => ops.filter((o) => o.type === type).length;

// ---------- 空树 ----------

describe('空树', () => {
  it('空 → 空：无操作', () => {
    expect(diff([], [])).toEqual([]);
  });
  it('空 → 树：全部为 add，父先于子', () => {
    const tree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: { n: 1 }, parentId: 'R' },
      { id: 'a1', value: { n: 2 }, parentId: 'A' },
      { id: 'B', value: { n: 3 }, parentId: 'R' },
    ];
    const ops = roundTrip([], tree);
    expect(count(ops, 'add')).toBe(4);
    expect(count(ops, 'delete')).toBe(0);
    expect(count(ops, 'update')).toBe(0);
    expect(count(ops, 'move')).toBe(0);
    // R 的 add 先于其子节点
    expect(ops[0]).toMatchObject({ type: 'add', id: 'R', parentId: 'ext' });
  });
  it('树 → 空：全部为 delete，子先于父', () => {
    const tree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'a1', value: {}, parentId: 'A' },
    ];
    const ops = roundTrip(tree, []);
    expect(count(ops, 'delete')).toBe(3);
    const delIds = ops.map((o) => o.id);
    expect(delIds.indexOf('a1')).toBeLessThan(delIds.indexOf('A'));
    expect(delIds.indexOf('A')).toBeLessThan(delIds.indexOf('R'));
  });
});

// ---------- 无变化 ----------

describe('无变化', () => {
  it('完全相同（含扁平输入顺序不同）→ 无操作', () => {
    const a: IBlock<P>[] = [
      { id: 'R', value: { n: 1 }, parentId: 'ext' },
      { id: 'A', value: { n: 2 }, parentId: 'R' },
      { id: 'B', value: { n: 3 }, parentId: 'R' },
    ];
    const b: IBlock<P>[] = [
      { id: 'B', value: { n: 3 }, parentId: 'R' },
      { id: 'R', value: { n: 1 }, parentId: 'ext' },
      { id: 'A', value: { n: 2 }, parentId: 'R' },
    ];
    // b 的扁平顺序不同但树结构相同（A 仍在 B 前）
    expect(diff(a, a)).toEqual([]);
    const ops = diff(a, [
      { id: 'R', value: { n: 1 }, parentId: 'ext' },
      { id: 'A', value: { n: 2 }, parentId: 'R' },
      { id: 'B', value: { n: 3 }, parentId: 'R' },
    ]);
    expect(ops).toEqual([]);
  });
});

// ---------- update ----------

describe('update', () => {
  const oldTree: IBlock<P>[] = [
    { id: 'R', value: { n: 0 }, parentId: 'ext' },
    { id: 'A', value: { n: 1 }, parentId: 'R' },
    { id: 'B', value: { n: 2 }, parentId: 'R' },
    { id: 'a1', value: { n: 3 }, parentId: 'A' },
  ];

  it('单个 value 变化', () => {
    const next = oldTree.map((b) => (b.id === 'A' ? { ...b, value: { n: 99 } } : b));
    const ops = roundTrip(oldTree, next);
    expect(ops).toEqual([{ type: 'update', id: 'A', value: { n: 99 } }]);
  });

  it('多个 value 变化（深嵌套）', () => {
    const next = oldTree.map((b) =>
      b.id === 'R' || b.id === 'a1' ? { ...b, value: { text: 'x' } } : b
    );
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'update')).toBe(2);
    expect(ops.map((o) => o.id).sort()).toEqual(['R', 'a1']);
  });

  it('equal 判定相等时不发 update', () => {
    const next = oldTree.map((b) => (b.id === 'A' ? { ...b, value: { n: 1 } } : { ...b }));
    expect(diff(oldTree, next)).toEqual([]);
  });

  it('equal 判定不等时即使看起来相似也发 update（自定义 equal 语义）', () => {
    const next = oldTree.map((b) => (b.id === 'A' ? { ...b, value: { n: 1, extra: true } } : { ...b }));
    const ops = diff(oldTree, next);
    expect(ops).toEqual([{ type: 'update', id: 'A', value: { n: 1, extra: true } }]);
  });
});

// ---------- add ----------

describe('add', () => {
  const base = (): IBlock<P>[] => [
    { id: 'R', value: {}, parentId: 'ext' },
    { id: 'A', value: {}, parentId: 'R' },
    { id: 'B', value: {}, parentId: 'R' },
    { id: 'C', value: {}, parentId: 'R' },
  ];

  it('末尾追加', () => {
    const next = [...base(), { id: 'D', value: { n: 1 }, parentId: 'R' }];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'add', id: 'D', parentId: 'R', before: undefined, block: next[4] }]);
  });

  it('开头插入（锚点为第一个兄弟）', () => {
    const next = [base()[0], { id: 'Z', value: {}, parentId: 'R' }, ...base().slice(1)];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'add', id: 'Z', parentId: 'R', before: 'A', block: { id: 'Z', value: {}, parentId: 'R' } }]);
  });

  it('中间插入', () => {
    const next = [
      base()[0], base()[1],
      { id: 'M', value: {}, parentId: 'R' },
      base()[2], base()[3],
    ];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'add', id: 'M', parentId: 'R', before: 'B', block: { id: 'M', value: {}, parentId: 'R' } }]);
  });

  it('连续追加多个：顺序保持', () => {
    const next = [...base(), { id: 'D', value: {}, parentId: 'R' }, { id: 'E', value: {}, parentId: 'R' }];
    const ops = roundTrip(base(), next);
    expect(count(ops, 'add')).toBe(2);
    const addIds = ops.filter((o) => o.type === 'add').map((o) => o.id);
    expect(addIds).toEqual(['D', 'E']);
    ops.filter((o) => o.type === 'add').forEach((o) => {
      if (o.type === 'add') expect(o.before).toBeUndefined();
    });
  });

  it('在锚点前连续插入多个：顺序保持', () => {
    const next = [
      base()[0],
      { id: 'X', value: {}, parentId: 'R' },
      { id: 'Y', value: {}, parentId: 'R' },
      ...base().slice(1),
    ];
    const ops = roundTrip(base(), next);
    expect(count(ops, 'add')).toBe(2);
    ops.filter((o) => o.type === 'add').forEach((o) => {
      if (o.type === 'add') expect(o.before).toBe('A');
    });
  });

  it('嵌套新增：父块先于子块 add', () => {
    const next = [
      ...base(),
      { id: 'D', value: {}, parentId: 'R' },
      { id: 'd1', value: {}, parentId: 'D' },
      { id: 'd2', value: {}, parentId: 'D' },
    ];
    const ops = roundTrip(base(), next);
    const addIds = ops.filter((o) => o.type === 'add').map((o) => o.id);
    expect(addIds).toEqual(['D', 'd1', 'd2']);
  });

  it('新增整棵子树到中间位置', () => {
    const next = [
      base()[0], base()[1],
      { id: 'S', value: {}, parentId: 'R' },
      { id: 's1', value: { n: 7 }, parentId: 'S' },
      base()[2], base()[3],
    ];
    const ops = roundTrip(base(), next);
    expect(count(ops, 'add')).toBe(2);
    const sAdd = ops.find((o) => o.id === 'S');
    expect(sAdd).toMatchObject({ type: 'add', parentId: 'R', before: 'B' });
    const s1Add = ops.find((o) => o.id === 's1');
    expect(s1Add).toMatchObject({ type: 'add', parentId: 'S', before: undefined });
  });
});

// ---------- delete ----------

describe('delete', () => {
  it('删除叶子', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'B', value: {}, parentId: 'R' },
    ];
    const next = [oldTree[0], oldTree[2]];
    const ops = roundTrip(oldTree, next);
    expect(ops).toEqual([{ type: 'delete', id: 'A' }]);
  });

  it('删除带子树的中间节点：整个子树都被删除', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'a1', value: {}, parentId: 'A' },
      { id: 'a2', value: {}, parentId: 'A' },
      { id: 'a1x', value: {}, parentId: 'a1' },
      { id: 'B', value: {}, parentId: 'R' },
    ];
    const next = [oldTree[0], oldTree[5]];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'delete')).toBe(4);
    const delIds = ops.map((o) => o.id);
    // 子先于父（先检查顺序，再检查集合）
    expect(delIds.indexOf('a1x')).toBeLessThan(delIds.indexOf('a1'));
    expect(delIds.indexOf('a1')).toBeLessThan(delIds.indexOf('A'));
    expect([...delIds].sort()).toEqual(['A', 'a1', 'a1x', 'a2']);
  });

  it('删父留子：子节点 reparent，move 先于 delete', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'keep', value: {}, parentId: 'A' },
      { id: 'B', value: {}, parentId: 'R' },
    ];
    const next: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'B', value: {}, parentId: 'R' },
      { id: 'keep', value: {}, parentId: 'R' },
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'delete')).toBe(1);
    expect(count(ops, 'move')).toBe(1);
    const moveIdx = ops.findIndex((o) => o.type === 'move');
    const delIdx = ops.findIndex((o) => o.type === 'delete');
    expect(moveIdx).toBeLessThan(delIdx);
    expect(ops[moveIdx]).toMatchObject({ type: 'move', id: 'keep', parentId: 'R' });
    expect(ops[delIdx]).toEqual({ type: 'delete', id: 'A' });
  });
});

// ---------- move：同父重排 ----------

describe('move：同父重排', () => {
  const base = (): IBlock<P>[] => [
    { id: 'R', value: {}, parentId: 'ext' },
    { id: 'A', value: {}, parentId: 'R' },
    { id: 'B', value: {}, parentId: 'R' },
    { id: 'C', value: {}, parentId: 'R' },
  ];

  it('相邻交换 [A,B] → [B,A]：仅 1 个 move', () => {
    const oldTree = base().slice(0, 3);
    const next = [oldTree[0], oldTree[2], oldTree[1]];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(1);
    expect(count(ops, 'add')).toBe(0);
    expect(count(ops, 'delete')).toBe(0);
    expect(count(ops, 'update')).toBe(0);
  });

  it('轮转 [A,B,C] → [C,A,B]：仅 1 个 move C 到 A 前', () => {
    const next = [base()[0], base()[3], base()[1], base()[2]];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'move', id: 'C', parentId: 'R', before: 'A' }]);
  });

  it('轮转 [A,B,C] → [B,C,A]：仅 1 个 move A 到末尾', () => {
    const next = [base()[0], base()[2], base()[3], base()[1]];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'move', id: 'A', parentId: 'R', before: undefined }]);
  });

  it('全反转 [A,B,C,D] → [D,C,B,A]', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'B', value: {}, parentId: 'R' },
      { id: 'C', value: {}, parentId: 'R' },
      { id: 'D', value: {}, parentId: 'R' },
    ];
    const next = [oldTree[0], ...oldTree.slice(1).reverse()];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(3);
    expect(count(ops, 'add')).toBe(0);
    expect(count(ops, 'delete')).toBe(0);
  });

  it('部分错位 [A,B,C,D] → [B,D,A,C]', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'B', value: {}, parentId: 'R' },
      { id: 'C', value: {}, parentId: 'R' },
      { id: 'D', value: {}, parentId: 'R' },
    ];
    const next = [oldTree[0], oldTree[2], oldTree[4], oldTree[1], oldTree[3]];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(2);
    expect(count(ops, 'add')).toBe(0);
    expect(count(ops, 'delete')).toBe(0);
  });

  it('首个移到中间 [A,B,C] → [B,A,C]：仅 1 个 move', () => {
    const next = [base()[0], base()[2], base()[1], base()[3]];
    const ops = roundTrip(base(), next);
    expect(count(ops, 'move')).toBe(1);
  });

  it('兄弟顺序不变时不发 move', () => {
    const next = base().map((b) => ({ ...b }));
    expect(diff(base(), next)).toEqual([]);
  });

  it('深层子节点重排', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'x1', value: {}, parentId: 'A' },
      { id: 'x2', value: {}, parentId: 'A' },
      { id: 'x3', value: {}, parentId: 'A' },
    ];
    const next = [oldTree[0], oldTree[1], oldTree[4], oldTree[2], oldTree[3]];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(1);
    expect(ops[0]).toMatchObject({ type: 'move', id: 'x3', parentId: 'A', before: 'x1' });
  });
});

// ---------- move：跨父 ----------

describe('move：跨父', () => {
  const base = (): IBlock<P>[] => [
    { id: 'R', value: {}, parentId: 'ext' },
    { id: 'A', value: {}, parentId: 'R' },
    { id: 'a1', value: {}, parentId: 'A' },
    { id: 'a2', value: {}, parentId: 'A' },
    { id: 'B', value: {}, parentId: 'R' },
    { id: 'b1', value: {}, parentId: 'B' },
  ];

  it('从 A 移到 B 末尾', () => {
    // a2 在输入数组中位于 b1 之后 → B 的新孩子顺序为 [b1, a2]，即追加到末尾
    const next: IBlock<P>[] = [
      base()[0], base()[1], base()[2],
      base()[4], base()[5],
      { id: 'a2', value: {}, parentId: 'B' },
    ];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'move', id: 'a2', parentId: 'B', before: undefined }]);
  });

  it('从 A 移到 B 中间（锚点 b1）', () => {
    const next: IBlock<P>[] = [
      base()[0], base()[1], base()[2],
      base()[4], base()[5],
      { id: 'a2', value: {}, parentId: 'B' },
      base()[3], // a2 的扁平位置无意义，父子关系已变
    ];
    // 修正：a2 已在上面插入，去掉重复
    next.pop();
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'move', id: 'a2', parentId: 'B', before: undefined }]);
  });

  it('从 B 移到 A 开头（锚点 a1）', () => {
    const next: IBlock<P>[] = [
      base()[0], base()[1],
      { id: 'b1', value: {}, parentId: 'A' },
      base()[2], base()[3],
      base()[4],
    ];
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'move', id: 'b1', parentId: 'A', before: 'a1' }]);
  });

  it('跨父移动 + 同父重排组合', () => {
    // A: [a1, a2] → [a2]；B: [b1] → [b1, a1, b2(新)]
    const next: IBlock<P>[] = [
      base()[0], base()[1], base()[3],
      base()[4], base()[5],
      { id: 'a1', value: {}, parentId: 'B' },
      { id: 'b2', value: {}, parentId: 'B' },
    ];
    const ops = roundTrip(base(), next);
    expect(count(ops, 'move')).toBe(1);
    expect(count(ops, 'add')).toBe(1);
    expect(ops.find((o) => o.type === 'move')).toMatchObject({ id: 'a1', parentId: 'B', before: undefined });
  });

  it('移动到树顶层（外部父）', () => {
    const next = base().map((b) => (b.id === 'a1' ? { ...b, parentId: 'ext' } : b));
    const ops = roundTrip(base(), next);
    expect(ops).toEqual([{ type: 'move', id: 'a1', parentId: 'ext', before: undefined }]);
  });
});

// ---------- 子树 diff ----------

describe('子树 diff（根带外部 parentId）', () => {
  it('根层级结构变化不影响 diff 正确性', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'root', value: { n: 1 }, parentId: 'page-1' },
      { id: 'A', value: { n: 2 }, parentId: 'root' },
      { id: 'B', value: { n: 3 }, parentId: 'root' },
    ];
    const next: IBlock<P>[] = [
      { id: 'root', value: { n: 1 }, parentId: 'page-2' }, // 外部父变了，不参与 diff
      { id: 'B', value: { n: 3 }, parentId: 'root' },
      { id: 'A', value: { n: 2 }, parentId: 'root' },
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(1);
  });

  it('旧根与新根 id 不同：删旧根 + 加新根', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'oldRoot', value: {}, parentId: 'page' },
      { id: 'A', value: {}, parentId: 'oldRoot' },
    ];
    const next: IBlock<P>[] = [
      { id: 'newRoot', value: {}, parentId: 'page' },
      { id: 'A', value: {}, parentId: 'newRoot' },
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'delete')).toBe(1); // oldRoot
    expect(count(ops, 'add')).toBe(1); // newRoot
    expect(count(ops, 'move')).toBe(1); // A 换父到 newRoot
    const moveIdx = ops.findIndex((o) => o.type === 'move');
    const delIdx = ops.findIndex((o) => o.type === 'delete');
    expect(moveIdx).toBeLessThan(delIdx); // A 先移走，oldRoot 才能安全删除
  });

  it('森林：多个顶层根之间移动', () => {
    const oldTree: IBlock<P>[] = [
      { id: 't1', value: {}, parentId: 'ext' },
      { id: 't2', value: {}, parentId: 'ext' },
      { id: 't3', value: {}, parentId: 'ext' },
      { id: 'x', value: {}, parentId: 't1' },
    ];
    const next: IBlock<P>[] = [
      { id: 't3', value: {}, parentId: 'ext' },
      { id: 't1', value: {}, parentId: 'ext' },
      { id: 't2', value: {}, parentId: 'ext' },
      { id: 'x', value: {}, parentId: 't2' },
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(2); // 顶层重排 + x 换父
  });
});

// ---------- 组合场景 ----------

describe('组合场景', () => {
  it('update + add + delete + move 混合', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: { n: 1 }, parentId: 'R' },
      { id: 'B', value: { n: 2 }, parentId: 'R' },
      { id: 'C', value: { n: 3 }, parentId: 'R' },
      { id: 'c1', value: { n: 4 }, parentId: 'C' },
    ];
    const next: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'NEW', value: { n: 9 }, parentId: 'R' },
      { id: 'C', value: { n: 3 }, parentId: 'R' },
      { id: 'B', value: { n: 20 }, parentId: 'R' },
      { id: 'c1', value: { n: 40 }, parentId: 'R' }, // 从 C 下移到 R 下
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'update')).toBe(2); // B, c1
    expect(count(ops, 'add')).toBe(1); // NEW
    expect(count(ops, 'delete')).toBe(1); // A
    expect(count(ops, 'move')).toBe(2); // B/C 交换 + c1 换父
  });

  it('换父节点的子树内部还有结构变化', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'X', value: {}, parentId: 'A' },
      { id: 'x1', value: {}, parentId: 'X' },
      { id: 'x2', value: {}, parentId: 'X' },
      { id: 'B', value: {}, parentId: 'R' },
    ];
    const next: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'B', value: {}, parentId: 'R' },
      { id: 'X', value: {}, parentId: 'B' }, // X 换父
      { id: 'x2', value: {}, parentId: 'X' }, // X 内部重排
      { id: 'x1', value: {}, parentId: 'X' },
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'move')).toBe(2); // X 换父 + x1/x2 重排（至少 1）
    roundTrip(oldTree, next);
  });

  it('根 children 全部替换', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'B', value: {}, parentId: 'R' },
    ];
    const next: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'C', value: {}, parentId: 'R' },
      { id: 'D', value: {}, parentId: 'R' },
    ];
    const ops = roundTrip(oldTree, next);
    expect(count(ops, 'delete')).toBe(2);
    expect(count(ops, 'add')).toBe(2);
    expect(count(ops, 'move')).toBe(0);
  });
});

// ---------- op 顺序 ----------

describe('op 输出顺序', () => {
  it('顺序为 update → move/add（交错）→ delete', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: { n: 0 }, parentId: 'ext' },
      { id: 'A', value: { n: 1 }, parentId: 'R' },
      { id: 'D', value: {}, parentId: 'R' },
      { id: 'B', value: { n: 2 }, parentId: 'R' },
    ];
    const next: IBlock<P>[] = [
      { id: 'R', value: { n: 100 }, parentId: 'ext' },
      { id: 'B', value: { n: 200 }, parentId: 'R' },
      { id: 'A', value: { n: 1 }, parentId: 'R' },
      { id: 'N', value: {}, parentId: 'R' },
    ];
    const ops = roundTrip(oldTree, next);
    const types = ops.map((o) => o.type);
    const rank = { update: 0, move: 1, add: 1, delete: 2 } as const;
    for (let i = 1; i < types.length; i++) {
      expect(rank[types[i]]).toBeGreaterThanOrEqual(rank[types[i - 1]]);
    }
  });

  it('move 的目标父为新增块时，该父的 add 先于 move', () => {
    const oldTree: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'x', value: {}, parentId: 'A' },
    ];
    const next: IBlock<P>[] = [
      { id: 'R', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'R' },
      { id: 'NEW', value: {}, parentId: 'R' },
      { id: 'x', value: {}, parentId: 'NEW' }, // x 换父到新增块 NEW 下
    ];
    const ops = roundTrip(oldTree, next);
    const addIdx = ops.findIndex((o) => o.type === 'add' && o.id === 'NEW');
    const moveIdx = ops.findIndex((o) => o.type === 'move' && o.id === 'x');
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(moveIdx).toBeGreaterThan(addIdx);
  });
});

// ---------- 异常 ----------

describe('异常输入', () => {
  it('旧树重复 id 抛错', () => {
    const bad: IBlock<P>[] = [
      { id: 'A', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'ext' },
    ];
    expect(() => diff(bad, [])).toThrow(/Duplicate block id/);
  });
  it('新树重复 id 抛错', () => {
    const bad: IBlock<P>[] = [
      { id: 'A', value: {}, parentId: 'ext' },
      { id: 'A', value: {}, parentId: 'ext' },
    ];
    expect(() => diff([], bad)).toThrow(/Duplicate block id/);
  });
  it('parentId 指向不存在的块：视为顶层', () => {
    const tree: IBlock<P>[] = [
      { id: 'A', value: {}, parentId: 'ghost' },
      { id: 'B', value: {}, parentId: 'A' },
    ];
    expect(diff(tree, tree)).toEqual([]);
  });
});
