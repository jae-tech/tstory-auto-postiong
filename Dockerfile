# ===================================================================
# OCI Ampere A1 (ARM64) 최적화 Dockerfile - Playwright 버전
# 멀티 스테이지 빌드로 최종 이미지 경량화
# Playwright 브라우저 자동화 지원
# ===================================================================

# -------------------------------------------------------------------
# Stage 1: 빌드 단계
# Node.js 22 기반 이미지로 TypeScript 코드를 JavaScript로 컴파일
# -------------------------------------------------------------------
FROM --platform=linux/arm64 node:22-slim AS builder

WORKDIR /app

# 시스템 패키지 업데이트 및 필수 도구 설치
# - openssl: Prisma가 데이터베이스 연결에 필요
RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# 패키지 파일 복사
# - package.json, package-lock.json: 의존성 정보
# - prisma: Prisma 스키마 및 마이그레이션 파일
COPY package*.json ./
COPY prisma ./prisma/

# 의존성 설치 (프로덕션 + 개발 의존성 모두 설치)
# - 빌드 과정에서 @nestjs/cli, typescript 등 devDependencies 필요
# - npm ci: package-lock.json 기반 정확한 버전 설치로 재현 가능한 빌드 보장
RUN npm ci && \
    npm cache clean --force

# Prisma Client 생성 (빌드 시점에 필수)
# - TypeScript 코드에서 @prisma/client 임포트를 위해 필요
# - postinstall 스크립트로도 실행되지만 명시적으로 재실행하여 확실히 생성
RUN npx prisma generate

# 소스 코드 복사
# - tsconfig.json, tsconfig.build.json: TypeScript 컴파일 설정
# - src/: 컴파일할 소스 코드
# - nest-cli.json: NestJS CLI 설정
COPY . .

# TypeScript 코드를 JavaScript로 컴파일
# - nest build 명령어가 dist/ 디렉토리에 컴파일된 JavaScript 파일 생성
# - tsconfig.build.json 설정에 따라 src/ 디렉토리만 컴파일
RUN npm run build

# -------------------------------------------------------------------
# Stage 2: 프로덕션 런타임 단계
# 최종 이미지는 런타임 의존성만 포함하여 경량화
# -------------------------------------------------------------------
FROM --platform=linux/arm64 node:22-slim

WORKDIR /app

# Playwright 실행을 위한 시스템 의존성 설치
# - Chromium 브라우저가 동작하기 위한 필수 라이브러리들
# - 폰트: 다국어 웹 페이지 렌더링 지원
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    fonts-liberation \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 빌드 스테이지에서 생성된 파일 복사
# - node_modules/: 프로덕션 + 개발 의존성 (Playwright 포함)
# - dist/: 컴파일된 JavaScript 파일
# - prisma/: Prisma 스키마 (런타임 마이그레이션용)
# - package*.json: 메타데이터 및 스크립트
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Playwright 브라우저 설치 (Chromium만 설치하여 이미지 크기 최적화)
# - ARM64 환경에서 Chromium 바이너리 다운로드 및 설치
# - 약 200MB 추가 용량 사용
RUN npx playwright install chromium

# 비루트 사용자 생성 및 권한 설정 (보안 강화)
RUN useradd -m -u 1001 appuser && \
    chown -R appuser:appuser /app

USER appuser

# 포트 노출
EXPOSE 3000

# 헬스 체크 (선택사항)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 애플리케이션 시작
CMD ["node", "dist/main.js"]
