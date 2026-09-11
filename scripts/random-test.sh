#!/usr/bin/env bash
# 随机 round-trip 测试脚本
#
# 用法:
#   ./scripts/random-test.sh [次数] [minOps] [maxOps] [minNodes] [maxNodes] [seed]
#
# 参数:
#   次数      运行测试用例数（每例 = 随机树 + 随机操作序列 + diff round-trip 校验），默认 100
#   minOps    每例随机操作条数下限，默认 50
#   maxOps    每例随机操作条数上限，默认 100
#   minNodes  随机树节点数下限，默认 300
#   maxNodes  随机树节点数上限，默认 500
#   seed      基础随机种子（可选；失败时错误信息中会带出每例 seed，传入可复现）
#
# 示例:
#   ./scripts/random-test.sh                       # 100 次，每例 50~100 条操作，树 300~500 节点
#   ./scripts/random-test.sh 500                   # 500 次，其余默认
#   ./scripts/random-test.sh 200 10 30             # 200 次，每例 10~30 条操作
#   ./scripts/random-test.sh 100 50 100 1000 2000  # 100 次，树 1000~2000 节点
#   ./scripts/random-test.sh 1 50 100 300 500 42   # 复现 seed=42 的用例
set -euo pipefail
cd "$(dirname "$0")/.."

ITERS="${1:-100}"
MIN_OPS="${2:-50}"
MAX_OPS="${3:-100}"
MIN_NODES="${4:-300}"
MAX_NODES="${5:-500}"
SEED="${6:-}"

export RANDOM_ITERS="$ITERS"
export RANDOM_MIN_OPS="$MIN_OPS"
export RANDOM_MAX_OPS="$MAX_OPS"
export RANDOM_MIN_NODES="$MIN_NODES"
export RANDOM_MAX_NODES="$MAX_NODES"
if [[ -n "$SEED" ]]; then
  export RANDOM_SEED="$SEED"
fi

echo "==> 随机测试: ${ITERS} 个用例, 每例 ${MIN_OPS}~${MAX_OPS} 条随机操作, 树 ${MIN_NODES}~${MAX_NODES} 节点${SEED:+, seed=${SEED}}"
npx vitest run test/random.spec.ts
