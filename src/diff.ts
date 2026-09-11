/**
 * Block Tree Diff 算法
 *
 * 给定新旧两棵 block tree，diff 出一系列操作：add / delete / update / move。
 *
 * 输入约定：
 * - 每棵树以扁平的 IBlock 数组给出，父子关系由 parentId 关联；
 * - 根节点也可以有 parentId（子树 diff），该外部 parentId 不参与树内结构，
 *   但会在涉及根层级 add/move 时作为目标 parentId 透传；
 * - 同一棵树内 block id 唯一。
 *
 * 输出 op 顺序：update → move/add（按新树先序逐父节点、同父内按新孩子顺序交错）→ delete（后序，子先于父）。
 * 应用方需按输出顺序应用（详见 docs/ALGORITHM.md）。
 */

export interface IBlock<T = unknown> {
  id: string;
  props: T;
  parentId?: string;
}

/** 在 before 指定的兄弟节点前插入/移动；before 缺省表示追加到末尾 */
export interface AddOp<T = unknown> {
  type: 'add';
  id: string;
  parentId: string;
  before?: string;
  block: IBlock<T>;
}

export interface DeleteOp {
  type: 'delete';
  id: string;
}

export interface UpdateOp<T = unknown> {
  type: 'update';
  id: string;
  props: T;
}

export interface MoveOp {
  type: 'move';
  id: string;
  parentId: string;
  before?: string;
}

export type DiffOp<T = unknown> = AddOp<T> | DeleteOp | UpdateOp<T> | MoveOp;

export interface DiffOptions<T> {
  /** props 深比较，相等返回 true */
  equal: (a: T, b: T) => boolean;
}

/** 虚拟超根 id：当 move/add 的目标是树的顶层（外部父节点）且 block 自身没有 parentId 时使用 */
export const VIRTUAL_ROOT_ID = '__VIRTUAL_ROOT__';

interface Node<T> {
  block: IBlock<T>;
  parent: Node<T> | null; // null 表示挂在虚拟超根下
  children: Node<T>[];
}

function buildTree<T>(blocks: IBlock<T>[]): { root: Node<T>; nodes: Map<string, Node<T>> } {
  const nodes = new Map<string, Node<T>>();
  for (const b of blocks) {
    if (nodes.has(b.id)) throw new Error(`Duplicate block id: ${b.id}`);
    nodes.set(b.id, { block: b, parent: null, children: [] });
  }
  const root: Node<T> = { block: { id: VIRTUAL_ROOT_ID, props: null as T }, parent: null, children: [] };
  for (const b of blocks) {
    const node = nodes.get(b.id)!;
    const parent = b.parentId != null && nodes.has(b.parentId) ? nodes.get(b.parentId)! : root;
    node.parent = parent;
    parent.children.push(node);
  }
  return { root, nodes };
}

/** 先序遍历（含起始节点本身；虚拟根的 block.id 为 VIRTUAL_ROOT_ID） */
function* preOrder<T>(node: Node<T>): Generator<Node<T>> {
  yield node;
  for (const c of node.children) yield* preOrder(c);
}

/** 后序遍历（含起始节点本身） */
function* postOrder<T>(node: Node<T>): Generator<Node<T>> {
  for (const c of node.children) yield* postOrder(c);
  yield node;
}

/**
 * Myers diff 算法：求 a、b 的最长公共子序列（按元素相等匹配）。
 * 返回 LCS 中 (aIndex, bIndex) 对，按顺序排列。
 */
export function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const N = a.length;
  const M = b.length;
  if (N === 0 || M === 0) return [];
  const max = N + M;
  const offset = max; // v 数组中心偏移
  let v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset])) {
        x = v[k + 1 + offset]; // 向下走（对应 b 侧新增）
      } else {
        x = v[k - 1 + offset] + 1; // 向右走（对应 a 侧删除）
      }
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }
      next[k + offset] = x;
      if (x >= N && y >= M) done = true;
    }
    v = next;
  }
  // 回溯：trace[d] 是第 d 步之前的 v 状态
  const pairs: Array<[number, number]> = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d > 0; d--) {
    const vv = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vv[k - 1 + offset] < vv[k + 1 + offset])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vv[prevK + offset];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      pairs.push([x - 1, y - 1]);
      x--;
      y--;
    }
    x = prevX;
    y = prevY;
  }
  // d = 0：纯对角线（全部匹配）
  while (x > 0 && y > 0) {
    pairs.push([x - 1, y - 1]);
    x--;
    y--;
  }
  return pairs.reverse();
}

/**
 * 对两棵 block tree 做 diff。
 *
 * @param oldBlocks 旧树（扁平 block 数组；根可带指向树外的 parentId）
 * @param newBlocks 新树（同上）
 * @param options.equal props 深比较函数
 * @returns DiffOp 数组，顺序为：update（新树先序）→ move → delete（旧树后序，子先于父）→ add（新树先序，父先于子）
 */
export function diffBlockTrees<T>(
  oldBlocks: IBlock<T>[],
  newBlocks: IBlock<T>[],
  options: DiffOptions<T>
): DiffOp<T>[] {
  const { equal } = options;
  const oldTree = buildTree(oldBlocks);
  const newTree = buildTree(newBlocks);

  const oldIds = new Set(oldTree.nodes.keys());
  const survived = new Set<string>();
  for (const id of newTree.nodes.keys()) if (oldIds.has(id)) survived.add(id);

  const updates: UpdateOp<T>[] = [];
  /** move/add 交错输出：按新树先序遍历各父节点，同一父节点内按新孩子索引顺序 */
  const structural: DiffOp<T>[] = [];
  const deletes: DeleteOp[] = [];

  // ---------- update：新树先序，幸存节点 props 变化 ----------
  for (const node of preOrder(newTree.root)) {
    if (node === newTree.root) continue;
    const id = node.block.id;
    if (!survived.has(id)) continue;
    if (!equal(oldTree.nodes.get(id)!.block.props, node.block.props)) {
      updates.push({ type: 'update', id, props: node.block.props });
    }
  }

  // ---------- delete：旧树后序，仅删除未幸存节点（子先于父）----------
  for (const node of postOrder(oldTree.root)) {
    if (node === oldTree.root) continue;
    if (!survived.has(node.block.id)) {
      deletes.push({ type: 'delete', id: node.block.id });
    }
  }

  // ---------- move + add：按新树先序遍历每个"父节点"，同一父节点内按新孩子索引顺序 ----------
  // 关键不变量：
  // - 父节点自身的 add 一定先于其孩子发出的任何 move/add（先序保证），
  //   因此 move 的目标父（即使是新增块）应用时必然已存在；
  // - 同一父节点内按索引从左到右输出，锚点统一为"其后第一个稳定（LCS 命中）兄弟"，
  //   逐条应用后兄弟顺序与新树完全一致。
  for (const parent of preOrder(newTree.root)) {
    const isVirtual = parent === newTree.root;
    const parentId = isVirtual ? VIRTUAL_ROOT_ID : parent.block.id;

    const newChildren = parent.children;
    const newSeq = newChildren.filter((c) => survived.has(c.block.id));

    // oldSeq：该父节点在旧树中的幸存孩子（换父离开的节点不在 newSeq 中，自然不会匹配）
    const oldChildren = isVirtual
      ? oldTree.root.children
      : survived.has(parent.block.id)
        ? oldTree.nodes.get(parent.block.id)!.children
        : [];
    const oldSeq = oldChildren.filter((c) => survived.has(c.block.id));

    // LCS 锚点：位置保持不变的"稳定"孩子
    const oldIdsSeq = oldSeq.map((c) => c.block.id);
    const newIdsSeq = newSeq.map((c) => c.block.id);
    const stable = new Set<string>();
    for (const [ai, bi] of lcsPairs(oldIdsSeq, newIdsSeq)) {
      if (oldIdsSeq[ai] === newIdsSeq[bi]) stable.add(newIdsSeq[bi]);
    }

    const anchorAfter = (i: number): string | undefined => {
      for (let j = i + 1; j < newChildren.length; j++) {
        if (stable.has(newChildren[j].block.id)) return newChildren[j].block.id;
      }
      return undefined;
    };

    for (let i = 0; i < newChildren.length; i++) {
      const c = newChildren[i];
      // 目标父为树顶层时，透传 block 自身的外部 parentId
      const pid = isVirtual ? (c.block.parentId ?? VIRTUAL_ROOT_ID) : parentId;
      if (!survived.has(c.block.id)) {
        // 新块 → add
        structural.push({ type: 'add', id: c.block.id, parentId: pid, before: anchorAfter(i), block: c.block });
      } else if (!stable.has(c.block.id)) {
        // 幸存但错位（含换父）→ move
        structural.push({ type: 'move', id: c.block.id, parentId: pid, before: anchorAfter(i) });
      }
      // 稳定块：无需操作
    }
  }

  // delete 放在最后：所有 move 已把幸存子节点移出被删子树，add 的父/锚点也必然存在
  return [...updates, ...structural, ...deletes];
}
