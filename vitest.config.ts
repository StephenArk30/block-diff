import { defineConfig } from 'vitest/config';

// vitest 优先读取本文件（覆盖 vite.config.ts 的 root: 'demo'），
// 使测试在项目根目录被发现（test/ 下的 *.spec.ts）
export default defineConfig({});
