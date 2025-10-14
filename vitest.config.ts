import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'path';

/**
 * Vitest 설정 파일
 *
 * NestJS 프로젝트를 위한 Vitest 테스트 환경 설정
 * - SWC를 사용한 빠른 TypeScript 컴파일
 * - NestJS 모듈 구조 지원
 * - 경로 매핑 지원 (@nestjs/*, @prisma/* 등)
 */
export default defineConfig({
  // Vitest 테스트 설정
  test: {
    // 전역 테스트 API 활성화 (describe, it, expect 등)
    globals: true,

    // Node.js 환경에서 테스트 실행 (NestJS 서버 환경)
    environment: 'node',

    // 테스트 파일 패턴 (Glob)
    // src 디렉토리 내의 모든 .spec.ts 파일을 테스트로 인식
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],

    // 제외할 파일 패턴
    exclude: [
      'node_modules',
      'dist',
      'coverage',
      '**/*.e2e-spec.ts', // E2E 테스트는 별도 설정 파일 사용
    ],

    // 테스트 타임아웃 (밀리초)
    testTimeout: 30000, // 30초

    // 훅 타임아웃 (beforeAll, afterAll 등)
    hookTimeout: 30000,

    // 코드 커버리지 설정
    coverage: {
      // 커버리지 제공자 (v8 엔진 사용)
      provider: 'v8',

      // 커버리지 리포터 (여러 형식 지원)
      reporter: ['text', 'json', 'html', 'lcov'],

      // 커버리지 수집 대상
      include: ['src/**/*.ts'],

      // 커버리지 제외 대상
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.e2e-spec.ts',
        'src/main.ts',
        'src/**/*.module.ts',
        'src/**/*.interface.ts',
        'src/**/*.dto.ts',
        'node_modules',
        'dist',
        'test',
      ],

      // 커버리지 임계값 (선택사항)
      // thresholds: {
      //   lines: 80,
      //   functions: 80,
      //   branches: 80,
      //   statements: 80,
      // },
    },

    // 테스트 격리 (각 테스트 파일을 별도 프로세스에서 실행)
    isolate: true,

    // 병렬 실행 설정
    // threads: true, // 멀티 스레드 실행 (기본값)
    // maxThreads: 4, // 최대 스레드 수

    // 모의 객체(Mock) 설정
    mockReset: true, // 각 테스트 후 모든 mock 초기화
    restoreMocks: true, // 원본 함수 복원

    // 테스트 파일 변경 감지 (watch 모드)
    watch: false, // CLI에서 --watch로 활성화

    // 테스트 재시도 설정 (불안정한 테스트 대응)
    // retry: 2,
  },

  // SWC를 사용한 빠른 TypeScript 컴파일
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],

  // 경로 매핑 설정 (tsconfig.json과 일치)
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@test': resolve(__dirname, './test'),
    },
  },

  // 외부 모듈 처리
  // NestJS의 일부 모듈은 외부 모듈로 처리해야 올바르게 동작
  // ssr: {
  //   external: ['@nestjs/microservices', '@nestjs/websockets'],
  // },
});
