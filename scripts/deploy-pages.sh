#!/usr/bin/env bash
# 构建并部署 demo 到 GitHub Pages（gh-pages 分支）
# 前置：已运行 npm run demo:build:pages（或使用 npm run deploy:pages 一键完成）
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d dist-demo || ! -f dist-demo/index.html ]]; then
  echo "错误：dist-demo 不存在，请先运行 npm run demo:build:pages" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'git worktree remove --force "$WORK" 2>/dev/null || rm -rf "$WORK"' EXIT

# gh-pages 分支不存在则从孤儿分支创建
if git show-ref --verify --quiet refs/heads/gh-pages; then
  git worktree add "$WORK" gh-pages
else
  git worktree add --detach "$WORK" >/dev/null
  (cd "$WORK" && git checkout --orphan gh-pages && git rm -rf -q . >/dev/null 2>&1 || true)
fi

# 同步构建产物
(cd "$WORK" && find . -mindepth 1 -not -path './.git*' -delete)
cp -R dist-demo/. "$WORK"/
(cd "$WORK" && git add -A && git -c user.name="StephenArk30" -c user.email="stephenark@163.com" \
  commit -m "deploy: demo to GitHub Pages" >/dev/null && git push origin gh-pages)

echo "==> 已部署到 gh-pages 分支：https://stephenark30.github.io/block-diff/"
