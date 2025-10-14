const webpack = require('webpack');
const path = require('path');
const nodeExternals = require('webpack-node-externals');
const { RunScriptWebpackPlugin } = require('run-script-webpack-plugin');

/**
 * Webpack HMR 설정 (SWC 통합)
 *
 * 이 설정은 다음 기능을 제공합니다:
 * 1. SWC를 사용한 빠른 TypeScript 컴파일
 * 2. HMR(Hot Module Replacement)을 통한 즉각적인 코드 반영
 * 3. Node.js 외부 모듈 최적화
 * 4. 소스맵을 통한 디버깅 지원
 */
module.exports = function (options, webpack) {
  return {
    ...options,
    // HMR 엔트리 포인트: webpack/hot/poll을 먼저 로드
    entry: ['webpack/hot/poll?100', './src/main.ts'],

    // 개발 모드에서 소스맵 활성화 (디버깅 용이)
    devtool: 'source-map',

    // Node.js 환경 설정
    target: 'node',

    // Node.js 외부 모듈 처리
    // node_modules의 패키지들은 번들에 포함하지 않고 require()로 사용
    externals: [
      nodeExternals({
        // webpack/hot/poll은 번들에 포함시켜야 HMR 작동
        allowlist: ['webpack/hot/poll?100'],
      }),
    ],

    // 모듈 해석 설정
    resolve: {
      ...options.resolve,
      extensions: ['.tsx', '.ts', '.js', '.json'],
    },

    // SWC 로더 설정
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'swc-loader',
            options: {
              // .swcrc 파일의 설정을 사용
              jsc: {
                parser: {
                  syntax: 'typescript',
                  decorators: true,
                  dynamicImport: true,
                },
                target: 'es2021',
                keepClassNames: true,
                transform: {
                  legacyDecorator: true,
                  decoratorMetadata: true,
                },
              },
              module: {
                type: 'commonjs',
              },
              sourceMaps: true,
            },
          },
        },
      ],
    },

    // 플러그인 설정
    plugins: [
      ...options.plugins,

      // HMR 플러그인: 코드 변경 시 모듈 핫 리로드
      new webpack.HotModuleReplacementPlugin(),

      // 컴파일된 JS 파일 무시 (TypeScript 소스만 watch)
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),

      // 빌드 후 자동으로 스크립트 실행
      new RunScriptWebpackPlugin({
        name: options.output.filename,
        autoRestart: false, // HMR 사용 시 자동 재시작 비활성화
      }),
    ],

    // 빌드 최적화 비활성화 (개발 모드)
    optimization: {
      ...options.optimization,
      minimize: false, // 개발 중에는 압축하지 않음
    },

    // Watch 모드 설정
    watchOptions: {
      ignored: /node_modules/, // node_modules 변경 무시
      aggregateTimeout: 300,   // 파일 변경 후 300ms 대기
      poll: 1000,              // 1초마다 변경사항 폴링
    },
  };
};
