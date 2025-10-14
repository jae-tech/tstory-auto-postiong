// @ts-check
// ===================================================================
// ESLint 설정 파일 (Flat Config) - NestJS TypeScript 프로젝트
// 타입 안전성을 최우선으로 하는 엄격한 린트 규칙 적용
// ===================================================================

import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // -------------------------------------------------------------------
  // 1. 무시할 파일 패턴
  // -------------------------------------------------------------------
  {
    ignores: [
      'eslint.config.mjs',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'generated/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.d.ts',
    ],
  },

  // -------------------------------------------------------------------
  // 2. 기본 ESLint 추천 규칙
  // -------------------------------------------------------------------
  eslint.configs.recommended,

  // -------------------------------------------------------------------
  // 3. TypeScript ESLint 추천 규칙 (타입 체크 포함)
  // - recommendedTypeChecked: 타입 정보를 활용한 고급 검사
  // - strict: 더 엄격한 타입 안전성 규칙
  // -------------------------------------------------------------------
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.strict,

  // -------------------------------------------------------------------
  // 4. Prettier 통합 (포맷팅 규칙 충돌 방지)
  // -------------------------------------------------------------------
  eslintPluginPrettierRecommended,

  // -------------------------------------------------------------------
  // 5. 언어 옵션 및 파서 설정
  // -------------------------------------------------------------------
  {
    languageOptions: {
      // Node.js 및 Jest 전역 변수 허용
      globals: {
        ...globals.node,
        ...globals.jest,
      },

      // CommonJS 모듈 시스템 사용
      sourceType: 'commonjs',

      // TypeScript 파서 옵션
      parserOptions: {
        // 프로젝트의 tsconfig.json을 자동으로 찾아 타입 정보 활용
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // -------------------------------------------------------------------
  // 6. 커스텀 규칙 (타입 안전성 강화)
  // -------------------------------------------------------------------
  {
    rules: {
      // =================================================================
      // A. 타입 안전성 규칙 (Critical)
      // =================================================================

      // any 타입 사용 금지 (error로 설정하여 엄격하게 제한)
      '@typescript-eslint/no-explicit-any': 'error',

      // any 타입의 값에 대한 호출 금지
      '@typescript-eslint/no-unsafe-call': 'error',

      // any 타입의 멤버 접근 금지
      '@typescript-eslint/no-unsafe-member-access': 'error',

      // any 타입의 값 할당 금지
      '@typescript-eslint/no-unsafe-assignment': 'error',

      // any 타입의 값을 함수 인자로 전달 금지
      '@typescript-eslint/no-unsafe-argument': 'error',

      // any 타입의 값 반환 금지
      '@typescript-eslint/no-unsafe-return': 'error',

      // =================================================================
      // B. Promise 및 비동기 처리 규칙
      // =================================================================

      // Promise를 await 없이 사용하는 것을 금지 (중요!)
      '@typescript-eslint/no-floating-promises': 'error',

      // void를 반환하는 함수에서 값을 반환하지 않도록 강제
      '@typescript-eslint/no-misused-promises': 'error',

      // =================================================================
      // C. NestJS 데코레이터 관련 예외 처리
      // =================================================================

      // NestJS는 데코레이터를 많이 사용하므로, 사용하지 않는 변수 경고 완화
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_', // _로 시작하는 인자는 무시
          varsIgnorePattern: '^_', // _로 시작하는 변수는 무시
          ignoreRestSiblings: true,
        },
      ],

      // =================================================================
      // D. Prettier 포맷팅 규칙
      // =================================================================

      // Prettier 규칙 위반 시 에러 표시
      // endOfLine: "auto"로 설정하여 Windows/Linux 줄바꿈 차이 무시
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
        },
      ],

      // =================================================================
      // E. 기타 코드 품질 규칙
      // =================================================================

      // require() 사용 금지 (ES6 import 사용 강제)
      '@typescript-eslint/no-require-imports': 'warn',

      // 타입 추론이 가능한 경우 명시적 타입 선언 제거
      '@typescript-eslint/no-inferrable-types': 'warn',

      // 빈 함수 정의 경고
      '@typescript-eslint/no-empty-function': 'warn',

      // 빈 인터페이스 정의 금지
      '@typescript-eslint/no-empty-interface': 'warn',
    },
  },
);
