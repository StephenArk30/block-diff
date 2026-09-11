import { describe, it } from 'vitest';
import { runRandomTests } from './random-test';

// 可通过环境变量配置（见 scripts/random-test.sh）：
//   RANDOM_ITERS     运行用例数，默认 100
//   RANDOM_MIN_OPS   每例操作条数下限，默认 50
//   RANDOM_MAX_OPS   每例操作条数上限，默认 100
//   RANDOM_MIN_NODES 随机树节点数下限，默认 300
//   RANDOM_MAX_NODES 随机树节点数上限，默认 500
//   RANDOM_SEED      基础种子（用于复现失败用例），默认随机
const iters = Math.max(1, Number(process.env.RANDOM_ITERS ?? 100));
const minOps = Number(process.env.RANDOM_MIN_OPS ?? 50);
const maxOps = Number(process.env.RANDOM_MAX_OPS ?? 100);
const minNodes = Number(process.env.RANDOM_MIN_NODES ?? 300);
const maxNodes = Number(process.env.RANDOM_MAX_NODES ?? 500);
const baseSeed = Number(process.env.RANDOM_SEED ?? Date.now() % 1_000_000_000);

describe('随机操作序列 round-trip（完整树/子树 × 随机编辑操作）', () => {
  it(
    `${iters} 个用例，每例 ${minOps}~${maxOps} 条随机编辑操作，树大小 ${minNodes}~${maxNodes} 节点（baseSeed=${baseSeed}）`,
    () => {
      const { passed, modes } = runRandomTests(iters, { minOps, maxOps, minNodes, maxNodes, baseSeed });
      console.log(
        `随机测试通过: ${passed} 例（完整树 ${modes.complete} / 子树 ${modes.subtree}）`
      );
    }
  );
});
