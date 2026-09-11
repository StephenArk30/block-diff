# block-diff

[English](./README.md) | 简体中文

Block tree diff 算法：给定新旧两棵 block tree，diff 出一系列操作 —— **add / delete / update / move**。

- 输入为扁平 `IBlock[]`（父子关系由 `parentId` 关联），支持**子树 diff**（树根可带指向树外的 `parentId`）与森林；
- `value` 比较由调用方注入 `equal` 函数；
- 同父重排基于 **Myers LCS**，单父内 move 数为理论最小值；
- 附带参考实现 `applyOps`（op 应用器）与可视化 demo（中英双语）。

**在线 Demo**：https://stephenark30.github.io/block-diff/

## 安装与使用

```bash
npm install
npm test              # 全部测试（含 fuzz + 随机 round-trip）
npm run demo          # 本地启动可视化 demo: http://localhost:5173
```

### API

```ts
import { diffBlockTrees, applyOps, type IBlock, type DiffOp } from './src/index';

interface IBlock<T> { id: string; value: T; parentId?: string }

const ops: DiffOp<MyProps>[] = diffBlockTrees(oldBlocks, newBlocks, {
  equal: (a, b) => isEqual(a, b),   // value 深比较，由调用方注入
});
// op 类型：
// add:    { type: 'add',    id, parentId, before?, block }  // 在 before 前插入（缺省 = 追加到末尾）
// delete: { type: 'delete', id }
// update: { type: 'update', id, value }
// move:   { type: 'move',   id, parentId, before? }         // 移动 block（含子树）到 before 前

const newBlocks2 = applyOps(oldBlocks, ops);  // 参考应用器（需按输出顺序应用）
```

---

# 算法说明

## 1. 问题定义

给定新旧两棵 block tree，计算把旧树变换为新树的操作序列。

**输入约定**：

- 每棵树以扁平的 `IBlock[]` 给出，父子关系由 `parentId` 关联；数组顺序即兄弟顺序；
- 树可能只是某个更大文档的**子树**，根节点的 `parentId` 指向树外的真实父节点（如 `'page-1'`）；
- 同一棵树内 `id` 唯一（重复会抛错）；
- `value` 的比较完全依赖调用方注入的 `equal(a, b)` 函数。

## 2. 算法总览

算法分为三个阶段，分别产出 `update`、`move`/`add`（交错）、`delete`：

```
① 预处理
   buildTree(oldBlocks) / buildTree(newBlocks)
   - 校验 id 唯一；
   - parentId 不在集合内的块（含根的外部 parentId）统一挂到"虚拟超根" __VIRTUAL_ROOT__ 下，
     由此子树 / 森林 / 单根三种输入被归一为同一种结构；
   - survived = 新旧两树 id 的交集（"幸存"节点）。

② 逐类计算 op
   update  ：新树先序扫描幸存节点，value 不 equal 则发 update；
   move/add：按新树先序逐个父节点处理，同父内按新孩子顺序从左到右；
   delete  ：旧树后序扫描，未幸存节点发 delete（子先于父）。

③ 输出顺序：update → move/add（交错）→ delete
```

## 3. 核心概念

| 概念 | 定义 | 作用 |
|---|---|---|
| **幸存（survived）** | `id ∈ 新树 ∩ 旧树` | 区分 add/delete 与 update/move 的对象 |
| **稳定（stable）** | 在某父节点的孩子序列中，被新旧序列 LCS 命中的幸存块 | 作为锚点（anchor），不发出任何 op |
| **错位（displaced）** | 幸存但不稳定的孩子 | 发出 move（含换父场景） |
| **锚点（before）** | 当前块之后**第一个稳定兄弟** | add/move 的插入定位；无则追加到末尾 |

**关键引理（LCS 性质）**：稳定集合内的块在新旧两个兄弟序列中相对顺序一致。因此稳定块天然"已在正确位置"，所有重排只需移动错位块。

## 4. 各 op 的产生规则

### 4.1 update

对新树做先序遍历，每个幸存节点调用 `equal(old.value, new.value)`，不相等则发 `{ update, id, value: 新value }`。与结构无关，可独立先行。

### 4.2 move / add（算法核心）

对新树做先序遍历，对每个**父节点 P**（含虚拟超根）：

1. 收集 P 的两组孩子序列（只含幸存块，保持各自顺序）：
   - `oldSeq`：P 在旧树中的幸存孩子（换父离开的块不在 P 的新孩子里，天然不参与匹配）；
   - `newSeq`：P 在新树中的幸存孩子（换父加入的块只出现在此侧）。
2. 对两个 id 序列求 **LCS（Myers diff 算法，O((N+M)·D)）**，命中的块标记为稳定。
3. 从左到右扫描 P 的**新孩子**（含新增块）：
   - 新块 → 发 `add`，锚点 = 其后第一个稳定兄弟；
   - 幸存但错位 → 发 `move`，锚点 = 其后第一个稳定兄弟；
   - 稳定块 → 不发 op。

> 换父的块一定出现在新父的 `newSeq` 中且不在其 `oldSeq` 中，故必然"错位"，由**新父**的扫描发出唯一一个 move；旧父一侧因为它不在 `newSeq` 中而不会重复发 op。

### 4.3 delete

对旧树做后序遍历，未幸存的块发 `delete`。后序保证子先于父。注意：**未幸存块的子树里可能有幸存块**（被 move 到了新父），所以 delete 不能按"整棵子树"盲删，而是逐块发出，由 move 先把它们摘出去（见 §5 顺序保证）。

## 5. op 输出顺序与正确性

输出顺序固定为：**`update` → `move`/`add`（按新树先序逐父节点、同父内按新孩子索引顺序交错）→ `delete`（后序）**。按此顺序应用可保证最终结构与新树完全一致，理由：

1. **move 的目标父必然已存在**：move 由新父 P 的扫描发出，而 P 自身若是新增块，其 `add` 在 P 的父节点扫描时已发出（先序：祖父 → P → P 的孩子），故应用 move 时 P 已在树中。
2. **add/move 的锚点必然存在**：锚点只能是稳定块（旧树幸存块），在 update/add/move 阶段始终存在。
3. **同父内按索引从左到右应用后，兄弟顺序与新树一致**：每条 op 都把当前块插入到"其后第一个稳定兄弟"之前。归纳可证：处理完索引 i 后，孩子序列前 i+1 个位置上的块集合及其相对顺序均与新树一致——稳定块是分段的"隔板"，错位块和新块总是被放进正确的隔间，且同隔间内按处理顺序排列。
4. **delete 放在最后**：所有 move 已把幸存块移出被删子树，删除不会误伤；被删块也不会是任何 add 的父或锚点（它们都不在新树中）。

一个最小例子——旧 `[A,B,C]` → 新 `[C,A,B]`：LCS = `[A,B]`（稳定），C 错位，锚点 A，仅 1 个 move：`{ move C, before A }`。

## 6. 子树 / 森林 / 外部 parentId 的处理

- 根（或多根）的 `parentId` 指向树外时不参与树内结构，统一挂到虚拟超根；
- 当 add/move 的目标是**树顶层**时，op 的 `parentId` 透传该 block 自身的外部 `parentId`；若没有，则使用哨兵值 `VIRTUAL_ROOT_ID`（`'__VIRTUAL_ROOT__'`）；
- 新旧子树根 id 不同时：旧根 delete、新根 add（其 `parentId` 为外部父），原根下的幸存块经 move 换父到新根下——move 先于 delete，保证应用安全；
- 顶层多根（森林）之间的重排同样由虚拟超根的 LCS 机制处理。

## 7. 复杂度

设 n 为树的大小（块数）：

| 阶段 | 复杂度 |
|---|---|
| 建树 + 幸存集 | O(n) |
| update 扫描 | O(n · E)，E 为单次 equal 成本 |
| 每个父节点的 LCS（Myers） | O((N+M)·D)，N/M 为该父的孩子数、D 为孩子序列的编辑距离 |
| 锚点查找（可优化为一次逆扫） | 当前实现为每块向前线性扫，最坏 O(k²)（k 为单父孩子数） |

整体近似 **O(n · d)**，d 为平均结构扰动量，远优于把整个树打平做全局 diff 的方案（后者无法区分"移动"与"删除+新增"）。

## 8. 应用语义（`applyOps`）

`src/apply.ts` 提供参考实现，用于测试验证 round-trip：

- `update`：按 id 覆盖 value；
- `move`：将块（含子树）从当前位置摘下，插入 `parentId` 下 `before` 前；`parentId` 解析不到时视为树顶层，保留外部 parentId；
- `delete`：按 id 删除块及其子树（op 顺序保证此时子树内已无应幸存的块）；
- `add`：在 `parentId` 下 `before` 前插入新块。

**必须按输出顺序应用**。

## 9. LCS 是什么

LCS = **Longest Common Subsequence（最长公共子序列）**：给定两个序列，找出同时是两者子序列的最长序列（子序列不要求连续，但保持相对顺序）。

在本算法中，LCS 用于**每个父节点的兄弟序列对齐**：命中的块（稳定块）相对顺序在新旧两轮中一致，视为"不用动"，充当锚点；不在 LCS 里的幸存块说明错位，发出 move。LCS 越长，需要移动的块越少——**move 数 = 孩子数 − |LCS|**，为该父的理论最小值。实现采用 Myers diff 算法（git diff 同款，O((N+M)·D)）。

## 10. 测试

- `test/diff.spec.ts`：42 个确定性用例，覆盖空树、无变化、update/add/delete/move 单类行为、同父重排（轮转/反转/部分错位）、跨父移动、子树与森林、根替换、删父留子、op 顺序不变量、异常输入；
- `test/fuzz.spec.ts`：随机树 + 随机变异的 **round-trip 性质测试**——`apply(old, diff(old, new))` 必须与 `new` 完全一致，共 2000 组随机种子；
- `test/random-test.ts` + `test/random.spec.ts`：**随机编辑操作序列** round-trip——随机生成树（随机完整树/子树，节点数 ∈ [minNodes, maxNodes]，默认 [300, 500]），再随机生成 n 条编辑操作（默认 [50, 100]）逐条叠加产生新树，校验 round-trip。生成器使用独立树模型（`GenTree`），不复用 `applyOps`，避免"生成与校验同源"掩盖 bug。

随机测试脚本：

```bash
./scripts/random-test.sh                       # 100 次，每例 50~100 条操作，树 300~500 节点
./scripts/random-test.sh 500                   # 500 次，其余默认
./scripts/random-test.sh 200 10 30             # 200 次，每例 10~30 条操作
./scripts/random-test.sh 100 50 100 1000 2000  # 100 次，树 1000~2000 节点
./scripts/random-test.sh 1 50 100 300 500 42   # 复现 seed=42 的用例
```

**pre-commit hook**：提交前自动运行全部测试 + 100 次随机测试（husky，`npm install` 后经 `prepare` 脚本自动启用）。

## 11. 可视化 demo

`src/demo/` 目录下是 Vue 3 + Vite 单页应用（支持中英文切换）。**布局**：

```
┌─ 工具栏 ──────────────────────────────────────────────────────┐
├──────────────────────────────┬─────────────────────────────────┤
│  旧树（动画区）               │  目标新树（静态）  ← 中间分隔条可拖 │
│      [root]                 │      [root]                     │
│     /  |  \                 │     /  |  \                     │
│  [b1] [b2] [b3]             │  [b1] [b2] [b3]                 │
├──────────────────────────────┴─────────────────────────────────┤
│  随机生成的编辑动作（可点击回放）：单行横向 chips + 滚动条      │
│  Diff 动作序列（可点击前进）：单行横向 chips + 滚动条          │
└────────────────────────────────────────────────────────────────┘
```

- 工具栏填入**节点范围**（默认 3~10）与**动作数量**范围（默认 5~10），随机生成旧树与新树（`value` 为随机字符串）；
- 两条动作序列均可点击回放：每条最前面有**状态 0**（回到初始旧树）；在一条序列应用过后点击另一条，会清空状态从旧树重新开始应用；
- 动画：**新增** → 绿色闪烁 + 淡入放大；**删除** → 红色闪烁后消散；**修改** → 黄色两次闪烁；**移动** → 蓝色闪烁 + FLIP 平滑滑动（连线为 SVG line，同样走 FLIP）；闪烁全程不透明度保持 1，避免晃眼；
- **国际化**：vue-i18n，工具栏右侧下拉菜单切换中文/English，选择记忆在 localStorage。

```bash
npm run demo                    # 开发模式：http://localhost:5173/
npm run demo:build              # 生产构建到 dist-demo/
```

### 自动部署（GitHub Actions）

推送 main 分支后，`.github/workflows/deploy-pages.yml` 自动构建并部署 demo 到 GitHub Pages：<https://stephenark30.github.io/block-diff/>，也支持在 Actions 页面手动触发（workflow_dispatch）。

## 12. 已知取舍

- **move 数量的最优性是"逐父局部最优"**：每个父节点内错位块数 = 孩子数 − |LCS|，为该父的理论最小值；
- LCS 的选取不唯一时（长度相同的多条 LCS），Myers 返回其中一条，op 内容可能不同，但均为正确解（round-trip 恒成立）；
- 输入含环（`parentId` 互指成环）属非法输入，行为未定义。
