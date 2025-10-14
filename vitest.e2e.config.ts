import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'path';

/**
 * Vitest E2E 테스트 설정 파일
 *
 * End-to-End 테스트를 위한 별도 설정
 * - 실제 HTTP 서버 시작 및 테스트
 * - 통합 테스트 환경 구성
 * - 더 긴 타임아웃 설정
 */
export default defineConfig({
  test: {
    // 전역 테스트 API
    globals: true,

    // Node.js 환경
    environment: 'node',

    // E2E 테스트 파일만 포함
    include: ['test/**/*.e2e-spec.ts'],

    // 제외할 패턴
    exclude: ['node_modules', 'dist', 'coverage', 'src/**/*.spec.ts'],

    // E2E 테스트는 시간이 오래 걸릴 수 있음
    testTimeout: 60000, // 60초
    hookTimeout: 60000,

    // E2E 테스트는 순차 실행 권장 (격리된 환경)
    isolate: true,

    // 각 테스트 파일 실행 전후 설정
    // setupFiles: ['./test/setup-e2e.ts'],

    // Mock 설정
    mockReset: true,
    restoreMocks: true,

    // E2E 테스트는 실패 시 재시도 (네트워크 불안정성 대응)
    retry: 1,
  },

  // SWC 컴파일러
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],

  // 경로 매핑
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test'),
    },
  },
});
