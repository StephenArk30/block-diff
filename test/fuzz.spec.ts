import { describe, it, expect } from 'vitest';
import isEqual from 'lodash/isEqual';
import { diffBlockTrees, applyOps, type IBlock } from '../src/index';

interface P {
  v: number;
}

/** 可复现的伪随机数生成器（LCG） */
function makeRng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)];

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 随机生成一棵子树（根的 parentId 指向外部 'ext'） */
function randomBlocks(rng: () => number, count: number): IBlock<P>[] {
  const blocks: IBlock<P>[] = [];
  for (let i = 0; i < count; i++) {
    const id = `b${i}`;
    // 70% 挂到已有块下，否则为顶层（外部父）
    const parent =
      blocks.length > 0 && rng() < 0.7
        ? pick(rng, blocks).id
        : rng() < 0.5
          ? 'ext'
          : undefined;
    blocks.push({ id, value: { v: Math.floor(rng() * 10) }, parentId: parent });
  }
  return shuffle(blocks, rng);
}

/** 随机变异：改 value / 删块(子块上提) / 加块 / 换父 / 乱序 */
function mutateBlocks(rng: () => number, blocks: IBlock<P>[]): IBlock<P>[] {
  let cur: IBlock<P>[] = blocks.map((b) => ({ ...b, value: { ...b.value } }));

  // 1. 随机改 value
  for (const b of cur) if (rng() < 0.3) b.value.v = Math.floor(rng() * 10);

  // 2. 随机删除若干块，其子块沿父链上提到第一个未删祖先
  const toDelete = new Set(cur.filter(() => rng() < 0.25).map((b) => b.id));
  const parentOf = new Map(cur.map((b) => [b.id, b.parentId ?? '']));
  const resolve = (id: string): string => {
    if (id === '' || id == null) return '';
    if (!toDelete.has(id)) return id;
    return resolve(parentOf.get(id) ?? '');
  };
  cur = cur
    .filter((b) => !toDelete.has(b.id))
    .map((b) => {
      const p = resolve(b.parentId ?? '');
      return { ...b, parentId: p === '' ? (rng() < 0.5 ? 'ext' : undefined) : p };
    });

  // 3. 随机新增若干块（父从已有块中选，保证无环）
  const addCount = Math.floor(rng() * 5);
  for (let i = 0; i < addCount; i++) {
    const id = `n${i}_${Math.floor(rng() * 1e9)}`;
    const parent =
      cur.length > 0 && rng() < 0.8
        ? pick(rng, cur).id
        : rng() < 0.5
          ? 'ext'
          : undefined;
    cur.push({ id, value: { v: Math.floor(rng() * 10) }, parentId: parent });
  }

  // 4. 随机换父（目标须为存活块/外部，且不得使当前块成为目标的祖先，保证无环）
  const idxOf = new Map(cur.map((b, i) => [b.id, i]));
  const reaches = (fromIdx: number, targetId: string): boolean => {
    // 沿 parentId 链向上，判断从 fromIdx 出发是否会碰到 targetId（target 是 from 的祖先 → 成环）
    let i = fromIdx;
    for (let guard = 0; guard <= cur.length; guard++) {
      if (cur[i].id === targetId) return true;
      const pid = cur[i].parentId;
      if (pid == null || !idxOf.has(pid)) return false;
      i = idxOf.get(pid)!;
    }
    throw new Error('mutateBlocks: 初始树意外成环');
  };
  for (let i = 0; i < cur.length; i++) {
    if (rng() < 0.2) {
      // 目标不能是 i 自身祖先链上的块（否则 i.parent = target 会成环）
      const candidates = cur.filter((b, j) => j !== i && !reaches(j, cur[i].id));
      cur[i].parentId =
        candidates.length > 0 && rng() < 0.8
          ? pick(rng, candidates).id
          : rng() < 0.5
            ? 'ext'
            : undefined;
    }
  }

  // 5. 乱序扁平输入（改变兄弟顺序 / 先序）
  return shuffle(cur, rng);
}

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

describe('fuzz: 随机 round-trip 性质测试', () => {
  it('随机树 + 随机变异：apply(diff(old, new)) === new（500 组）', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rng = makeRng(seed);
      const oldB = randomBlocks(rng, 2 + Math.floor(rng() * 18));
      const newB = mutateBlocks(rng, oldB);
      const ops = diffBlockTrees(oldB, newB, { equal: (a, b) => isEqual(a, b) });
      let applied: IBlock<P>[];
      try {
        applied = applyOps(oldB, ops);
      } catch (e) {
        throw new Error(`seed=${seed} apply 失败: ${(e as Error).message}\nops=${JSON.stringify(ops)}`);
      }
      const got = serialize(applied);
      const want = serialize(newB);
      if (!isEqual(got, want)) {
        throw new Error(
          `seed=${seed} round-trip 不一致\nold=${JSON.stringify(oldB)}\nnew=${JSON.stringify(newB)}\nops=${JSON.stringify(ops)}\ngot=${JSON.stringify(got)}`
        );
      }
      // 不变量：同一 op 的 id 不重复出现（add/delete/move/update 各自幂等语义）
      const ids = ops.map((o) => `${o.type}:${o.id}`);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('相同输入 diff 结果为空（含随机树）', () => {
    for (let seed = 1000; seed < 1050; seed++) {
      const rng = makeRng(seed);
      const tree = randomBlocks(rng, 5 + Math.floor(rng() * 15));
      expect(diffBlockTrees(tree, tree, { equal: isEqual })).toEqual([]);
      // 浅拷贝（value 引用相同）也应为空
      expect(diffBlockTrees(tree, tree.map((b) => ({ ...b })), { equal: isEqual })).toEqual([]);
    }
  });

  it('move 最小性：单元素轮转只产生 1 个 move（随机验证）', () => {
    for (let seed = 2000; seed < 2050; seed++) {
      const rng = makeRng(seed);
      const n = 3 + Math.floor(rng() * 8);
      const oldB: IBlock<P>[] = [{ id: 'R', value: { v: 0 }, parentId: 'ext' }];
      for (let i = 0; i < n; i++) oldB.push({ id: `c${i}`, value: { v: i }, parentId: 'R' });
      // 轮转：把第一个移到末尾 → 仅 1 个 move
      const rotated = [oldB[0], ...oldB.slice(2), oldB[1]];
      const ops = diffBlockTrees(oldB, rotated, { equal: isEqual });
      expect(ops.filter((o) => o.type === 'move').length).toBe(1);
      expect(applyOps(oldB, ops).length).toBe(oldB.length);
    }
  });
});
