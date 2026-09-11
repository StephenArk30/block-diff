# block-diff

English | [简体中文](./README.cn.md)

A block tree diff algorithm: given an old and a new block tree, produce a sequence of operations — **add / delete / update / move**.

- Input is a flat `IBlock[]` (parent-child relations via `parentId`); supports **subtree diff** (tree roots may carry a `parentId` pointing outside the tree) and forests;
- `value` comparison is injected by the caller via an `equal` function;
- Same-parent reordering is based on **Myers LCS**; the number of moves per parent is the theoretical minimum;
- Ships with a reference applier `applyOps` and an interactive visual demo (English / 中文).

**Live demo**: https://stephenark30.github.io/block-diff/

## Install & Usage

```bash
npm install
npm test              # all tests (fuzz + random round-trip included)
npm run demo          # run the visual demo locally: http://localhost:5173
```

### API

```ts
import { diffBlockTrees, applyOps, type IBlock, type DiffOp } from './src/index';

interface IBlock<T> { id: string; value: T; parentId?: string }

const ops: DiffOp<MyProps>[] = diffBlockTrees(oldBlocks, newBlocks, {
  equal: (a, b) => isEqual(a, b),   // deep comparison of value, injected by the caller
});
// Op types:
// add:    { type: 'add',    id, parentId, before?, block }  // insert before `before` (omitted = append at end)
// delete: { type: 'delete', id }
// update: { type: 'update', id, value }
// move:   { type: 'move',   id, parentId, before? }         // move block (with subtree) before `before`

const newBlocks2 = applyOps(oldBlocks, ops);  // reference applier (must apply in output order)
```

---

# Algorithm

## 1. Problem

Given an old and a new block tree, compute a minimal sequence of operations transforming the old tree into the new one.

**Input conventions**:

- Each tree is given as a flat `IBlock[]`; parent-child relations are expressed via `parentId`; array order defines sibling order;
- A tree may be a **subtree** of a larger document — its root's `parentId` points to the real parent outside the tree (e.g. `'page-1'`);
- Block `id`s are unique within a tree (duplicates throw);
- `value` comparison relies entirely on the caller-provided `equal(a, b)`.

## 2. Overview

The algorithm runs in three phases producing `update`, then `move`/`add` (interleaved), then `delete`:

```
① Preprocessing
   buildTree(oldBlocks) / buildTree(newBlocks)
   - validate unique ids;
   - blocks whose parentId is outside the set (including the roots' external parentIds) hang
     under a "virtual super root" __VIRTUAL_ROOT__, unifying subtree / forest / single-root
     inputs into one structure;
   - survived = intersection of ids of the two trees.

② Per-category op computation
   update  : pre-order scan of the new tree; emit update when value are not equal;
   move/add: per-parent processing in new-tree pre-order, left-to-right within a parent;
   delete  : post-order scan of the old tree; emit delete for non-survived blocks
             (children before parents).

③ Output order: update → move/add (interleaved) → delete
```

## 3. Core concepts

| Concept | Definition | Role |
|---|---|---|
| **survived** | `id ∈ new tree ∩ old tree` | Separates add/delete targets from update/move targets |
| **stable** | A survived child hit by the LCS of its parent's old/new child sequences | Serves as an anchor; emits no op |
| **displaced** | Survived but not stable | Emits a move (covers reparenting) |
| **anchor (`before`)** | The **first stable sibling after** the current block | Insertion target for add/move; omitted = append at end |

**Key lemma (LCS property)**: blocks in the stable set keep the same relative order in both the old and the new sibling sequences. Stable blocks are therefore already "in place"; all reordering only moves displaced blocks.

## 4. How each op is produced

### 4.1 update

Pre-order traversal of the new tree; for every survived node call `equal(old.value, new.value)` and emit `{ update, id, value }` when unequal. Independent of structure, so it can run first.

### 4.2 move / add (the core)

Pre-order traversal of the new tree; for every **parent P** (including the virtual super root):

1. Collect two child sequences of P (survived blocks only, each in its own order):
   - `oldSeq`: P's survived children in the old tree (blocks that left P are absent from P's new children, so they naturally don't participate);
   - `newSeq`: P's survived children in the new tree (blocks that moved into P appear only here).
2. Compute the **LCS of the two id sequences (Myers diff, O((N+M)·D))**; hit blocks are marked stable.
3. Scan P's **new children** (including new blocks) left to right:
   - new block → emit `add`, anchored at the first stable sibling after it;
   - survived but displaced → emit `move`, anchored at the first stable sibling after it;
   - stable block → emit nothing.

> A reparented block necessarily appears in the new parent's `newSeq` but not its `oldSeq`, hence is always "displaced": exactly one move is emitted by the **new parent's** scan; the old parent stays silent because the block is not in its `newSeq`.

### 4.3 delete

Post-order traversal of the old tree; non-survived blocks emit `delete` (children before parents). Note: **a non-survived block's subtree may contain survived blocks** (moved to new parents), so deletes are emitted per block instead of blindly cutting subtrees; the moves extract them first (see §5).

## 5. Output order and correctness

The output order is fixed: **`update` → `move`/`add` (new-tree pre-order per parent, child-index order within a parent) → `delete` (post-order)**. Applying in this order guarantees the final structure equals the new tree, because:

1. **A move's target parent always exists**: the move is emitted by new parent P's scan; if P is itself newly added, its `add` was emitted during P's parent's scan (pre-order: grandparent → P → P's children), so P already exists when the move applies.
2. **Anchors of add/move always exist**: anchors can only be stable blocks (old-tree survivors), which exist throughout the update/add/move phase.
3. **Applying in child-index order per parent yields the new sibling order**: every op inserts its block before "the first stable sibling after it". By induction, after processing index i the first i+1 positions match the new tree exactly — stable blocks act as fixed dividers, and displaced/new blocks fall into the correct compartment, ordered by processing order within it.
4. **Deletes come last**: all moves have already extracted survived blocks out of deleted subtrees, and a deleted block can never be the parent or anchor of any add (they are absent from the new tree).

Minimal example — old `[A,B,C]` → new `[C,A,B]`: LCS = `[A,B]` (stable), C is displaced anchored at A — a single move: `{ move C, before A }`.

## 6. Subtrees / forests / external parentIds

- Roots' `parentId`s pointing outside the tree do not participate in the in-tree structure; they hang under the virtual super root;
- When an add/move targets the **top level of the tree**, the op's `parentId` passes through the block's own external `parentId`; if absent, the sentinel `VIRTUAL_ROOT_ID` (`'__VIRTUAL_ROOT__'`) is used;
- When old and new subtree roots differ: the old root is deleted, the new root added (with its external `parentId`), and survived descendants move under the new root — moves precede the delete, keeping application safe;
- Reordering among multiple top-level roots (forests) is handled by the same LCS machinery on the virtual super root.

## 7. Complexity

Let n be the tree size (number of blocks):

| Phase | Complexity |
|---|---|
| Build trees + survived set | O(n) |
| update scan | O(n · E), E = cost of one `equal` call |
| LCS per parent (Myers) | O((N+M)·D), N/M = child counts, D = edit distance of the child sequences |
| Anchor lookup (optimizable to one reverse scan) | Currently a forward linear scan per block, worst-case O(k²) (k = children of one parent) |

Overall roughly **O(n · d)** where d is the average structural disturbance — far better than flattening the whole tree into a global diff (which cannot distinguish "move" from "delete + add").

## 8. Application semantics (`applyOps`)

`src/apply.ts` is the reference implementation, used by tests for round-trip verification:

- `update`: overwrite value by id;
- `move`: detach the block (with subtree) and insert before `before` under `parentId`; an unresolvable `parentId` means tree top level, keeping the external parentId;
- `delete`: remove the block and its subtree by id (op ordering guarantees no to-be-survived blocks remain inside);
- `add`: insert the new block before `before` under `parentId`.

**Must be applied in output order.**

## 9. What is LCS?

LCS = **Longest Common Subsequence**: the longest sequence that is a subsequence of both input sequences (subsequences keep relative order but need not be contiguous).

In this algorithm, LCS aligns **each parent's sibling sequences**: hit blocks (stable) keep their relative order across old and new, so they "don't move" and serve as anchors; survived blocks outside the LCS are displaced and emit moves. The longer the LCS, the fewer moves — **move count = children − |LCS|**, the per-parent theoretical minimum. Implemented with the Myers diff algorithm (the one git diff uses, O((N+M)·D)).

## 10. Tests

- `test/diff.spec.ts`: 42 deterministic cases covering empty trees, no-change, each op category, same-parent reordering (rotation / reversal / partial displacement), cross-parent moves, subtrees & forests, root replacement, delete-parent-keep-child, op-order invariants, invalid inputs;
- `test/fuzz.spec.ts`: random trees + random structural mutations as **round-trip property tests** — `apply(old, diff(old, new))` must exactly equal `new`; 2000 random seeds;
- `test/random-test.ts` + `test/random.spec.ts`: **random edit-sequence** round-trip — generate a random tree (randomly a complete tree or a subtree, node count ∈ [minNodes, maxNodes], default [300, 500]), then n random edit operations (default [50, 100]) applied one by one to build the new tree, and verify the round-trip. The generator uses an independent tree model (`GenTree`) instead of `applyOps`, avoiding "same-origin generation and verification" masking bugs.

Random test script:

```bash
./scripts/random-test.sh                       # 100 runs, 50~100 ops each, trees of 300~500 nodes
./scripts/random-test.sh 500                   # 500 runs, otherwise defaults
./scripts/random-test.sh 200 10 30             # 200 runs, 10~30 ops each
./scripts/random-test.sh 100 50 100 1000 2000  # 100 runs, trees of 1000~2000 nodes
./scripts/random-test.sh 1 50 100 300 500 42   # reproduce the seed=42 case
```

**pre-commit hook**: automatically runs all tests plus 100 random tests before every commit (husky; enabled by the `prepare` script upon `npm install`).

## 11. Visual demo

`src/demo/` contains a Vue 3 + Vite single-page app (English / 中文 switchable). **Layout**:

```
┌─ Toolbar ─────────────────────────────────────────────────────┐
├──────────────────────────────┬─────────────────────────────────┤
│  Old tree (animated)         │  Target new tree (static)       │
│      [root]                  │      [root]    ← draggable      │
│     /  |  \                  │     /  |  \       splitter      │
│  [b1] [b2] [b3]              │  [b1] [b2] [b3]                 │
├──────────────────────────────┴─────────────────────────────────┤
│  Randomly generated editing actions (click to replay)         │
│  Diff action sequence (click to advance)                       │
└────────────────────────────────────────────────────────────────┘
```

- Enter a **node range** (default 3~10) and an **action count** range (default 5~10) in the toolbar to randomly generate the old tree and the new tree (values are random strings);
- Both action strips are replayable: each starts with **state 0** (back to the initial old tree); clicking one strip after using the other resets and replays from the old tree;
- Animations: **add** → green flash + fade-in scale; **delete** → red flash then dissolve; **update** → double yellow flash; **move** → blue flash + smooth FLIP sliding (SVG connector lines also FLIP); flashing keeps opacity at 1 throughout to avoid glare;
- **i18n**: vue-i18n with a language dropdown (中文 / English) in the toolbar; the choice persists in localStorage.

```bash
npm run demo                    # dev mode: http://localhost:5173/
npm run demo:build              # production build into dist-demo/
```

### Automated deployment (GitHub Actions)

On every push to main, `.github/workflows/deploy-pages.yml` builds and deploys the demo to GitHub Pages: <https://stephenark30.github.io/block-diff/>. Manual triggering is also available via the Actions tab (workflow_dispatch).

## 12. Known trade-offs

- **Move-count optimality is per-parent local optimum**: displaced blocks per parent = children − |LCS|, the theoretical minimum for that parent;
- When multiple maximal LCS choices exist, Myers returns one of them; op contents may differ across runs but all are correct (round-trip always holds);
- Cyclic input (`parentId` forming a cycle) is invalid and behavior is undefined.
