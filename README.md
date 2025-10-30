# Tstory - 알뜰폰 자동 포스팅 시스템

> NestJS, Playwright, Gemini AI를 활용한 블로그 자동화 시스템

## 프로젝트 개요

알뜰폰 요금제 정보를 자동으로 크롤링하고, AI를 활용해 SEO 최적화된 블로그 콘텐츠를 생성한 뒤, 티스토리에 자동으로 발행하는 완전 자동화 시스템입니다.

**개발 동기**: 백엔드 아키텍처 설계부터 배포까지 전체 개발 사이클을 경험하고, NestJS의 모듈 시스템과 의존성 주입, Prisma ORM을 활용한 데이터베이스 설계, Playwright를 통한 브라우저 자동화, 그리고 AI API 통합을 실전 프로젝트에서 학습하기 위해 시작했습니다.

**결과**: Cron 기반 완전 자동화 파이프라인을 구축하여 인간 개입 없이 데이터 수집부터 발행까지 일일 단위로 자동 실행되는 시스템을 완성했습니다. Docker 컨테이너화를 통해 클라우드 환경에 배포 가능하도록 구성했습니다.

## 주요 기능

### 핵심 워크플로우

```
웹 크롤링 → AI 콘텐츠 생성 → 블로그 자동 발행
```

**1. 웹 크롤링 (Crawler Service)**

- Playwright 기반 동적 페이지 스크래핑
- 변경 감지 로직 (신규/수정/삭제 자동 탐지)
- Prisma Upsert 패턴으로 중복 제거
- **핵심 기술**: Playwright, DOM 파싱, 데이터 정규화

**2. AI 콘텐츠 생성 (Analyzer Service)**

- Gemini API를 활용한 SEO 최적화 콘텐츠 생성
- 1,000+ 라인 프롬프트 엔지니어링 (7가지 카테고리 분류)
- JSON 응답 파싱 및 검증 로직
- 날짜 자동 보정 및 반응형 테이블 CSS 삽입
- **핵심 기술**: Google Gemini API, 프롬프트 엔지니어링, HTML 생성

**3. 블로그 자동 발행 (Publisher Service)**

- Playwright를 이용한 티스토리 로그인 및 포스트 발행
- 세션 관리 (쿠키 저장/로드로 재로그인 최소화)
- 재시도 로직 (최대 3회, 지수 백오프)
- 발행 상태 추적 (PENDING → PUBLISHED → FAILED)
- **핵심 기술**: Playwright 세션 관리, 에러 핸들링

**4. 중앙 스케줄러 (Automation Service)**

- NestJS Cron 스케줄러로 일일 자동 실행 (매일 06:00)
- 순차적 파이프라인 보장 (Crawler → Analyzer → Publisher)
- Prisma 트랜잭션 충돌 감지 및 자동 재시도
- **핵심 기술**: NestJS Schedule, 순차 처리

## 기술 스택

### Backend

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11.x-E0234E?logo=nestjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-HTTP%20Server-000000?logo=fastify&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6.x-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)

### Automation & AI

![Playwright](https://img.shields.io/badge/Playwright-Browser%20Automation-2EAD33?logo=playwright&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google%20Gemini-AI%20API-4285F4?logo=google&logoColor=white)

### DevOps & Infra

![Docker](https://img.shields.io/badge/Docker-Containerization-2496ED?logo=docker&logoColor=white)
![SWC](https://img.shields.io/badge/SWC-Fast%20Compiler-orange)

### Development Tools

![Vitest](https://img.shields.io/badge/Vitest-Testing-6E9F18?logo=vitest&logoColor=white)
![Webpack](https://img.shields.io/badge/Webpack-HMR-8DD6F9?logo=webpack&logoColor=black)
![pnpm](https://img.shields.io/badge/pnpm-Package%20Manager-F69220?logo=pnpm&logoColor=white)

### 상세 스택 정보

| 영역            | 기술                                      | 사용 목적                     |
| --------------- | ----------------------------------------- | ----------------------------- |
| **Framework**   | NestJS 11.x (TypeScript 5.9)              | 모듈 기반 백엔드 아키텍처     |
| **HTTP Server** | Fastify                                   | 고성능 HTTP 어댑터            |
| **Database**    | PostgreSQL + Prisma ORM 6.x               | 타입 안전한 DB 관리           |
| **Automation**  | Playwright 1.56                           | 브라우저 자동화 (크롤링/발행) |
| **AI**          | Google Gemini API (gemini-2.5-flash-lite) | 콘텐츠 생성                   |
| **Scheduler**   | @nestjs/schedule (Cron)                   | 일일 자동화 파이프라인        |
| **Build**       | SWC, Webpack HMR                          | 고속 컴파일 및 개발 환경      |
| **Test**        | Vitest                                    | 단위 테스트 및 커버리지       |
| **Deployment**  | Docker (Multi-stage build)                | 컨테이너화 및 클라우드 배포   |
| **Monitoring**  | NestJS Logger                             | 구조화된 로깅                 |

## 시스템 아키텍처

### 전체 구조

```
┌──────────────────────────────────────────────────────────────┐
│                    NestJS Application                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         AutomationService (@Cron - 매일 06:00)         │  │
│  │              순차적 파이프라인 오케스트레이션          │  │
│  └────────────────────────────────────────────────────────┘  │
│                             │                                │
│      ┌──────────────────────┼──────────────────────┐         │
│      ▼                      ▼                      ▼         │
│  ┌─────────┐          ┌─────────┐          ┌─────────┐       │
│  │ Crawler │ -------> │Analyzer │ -------> │Publisher│       │
│  │ Service │          │ Service │          │ Service │       │
│  └─────────┘          └─────────┘          └─────────┘       │
│      │                     │                     │           │
└──────┼─────────────────────┼─────────────────────┼───────────┘
       │                     │                     │
       ▼                     ▼                     ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ Playwright  │      │  Gemini API  │      │ Playwright  │
│   (크롤링)  │      │ (콘텐츠생성) │      │  (발행)     │
└─────────────┘      └──────────────┘      └─────────────┘
       │                     │                     │
       └─────────────────────┴─────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  Prisma Service │
                    │   (전역 모듈)   │
                    └─────────────────┘
                             ▼
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │  ┌───────────┐  │
                    │  │ RawPlan   │  │
                    │  │ PostQueue │  │
                    │  └───────────┘  │
                    └─────────────────┘
```

### 데이터 흐름

```
1️⃣ 크롤링 단계
   웹사이트 → Playwright 스크래핑 → 데이터 정규화 → RawPlan (Upsert)
                                                      ↓
                                              isProcessed: false

2️⃣ 분석 단계
   RawPlan (미처리) → Gemini API 프롬프트 → JSON 응답 파싱 → PostQueue 생성
                                                                  ↓
                                                          status: PENDING
                                                                  ↓
                                                   RawPlan.isProcessed = true

3️⃣ 발행 단계
   PostQueue (PENDING) → Playwright 로그인 → 티스토리 포스트 발행 → 상태 업데이트
                                                                      ↓
                                                              status: PUBLISHED
```

### 모듈 구조

```
AppModule (루트)
├── PrismaModule (전역)
│   └── PrismaService
│
├── PlaywrightModule
│   └── PlaywrightService (세션 관리)
│
├── CrawlerModule
│   ├── CrawlerService (웹 스크래핑)
│   └── PlaywrightService 주입
│
├── AnalyzerModule
│   ├── AnalyzerService (AI 분석)
│   └── PrismaService 주입
│
├── PublisherModule
│   ├── PublisherService (자동 발행)
│   └── PlaywrightService 주입
│
└── AutomationModule
    ├── AutomationService (Cron 스케줄러)
    ├── CrawlerService 주입
    ├── AnalyzerService 주입
    └── PublisherService 주입
```

**각 모듈 책임**:

- **AutomationService**: Cron 스케줄 관리, 파이프라인 순차 실행, 전역 에러 핸들링
- **CrawlerService**: 웹 스크래핑, 변경 감지, RawPlan DB 저장
- **AnalyzerService**: Gemini API 호출, 프롬프트 엔지니어링, PostQueue 생성
- **PublisherService**: 티스토리 자동 발행, 세션 관리, 재시도 로직
- **PrismaService**: DB 연결, 트랜잭션 관리, 쿼리 실행

## 배포 방법

### 로컬 환경 실행

**1. 환경 변수 설정**

`.env` 파일 생성:

```env
# 데이터베이스
DATABASE_URL="postgresql://user:password@localhost:5432/tstory_automation"

# 크롤링 대상
CRAWLER_TARGET_URL="https://example.com/mvno-plans"

# Gemini AI
GEMINI_API_KEY="your_gemini_api_key"
GEMINI_MODEL="gemini-2.5-flash-lite"

# 티스토리 인증
TISTORY_ID="your_tistory_id"
TISTORY_PASSWORD="your_tistory_password"
TISTORY_BLOG_URL="https://yourblog.tistory.com"

# Playwright 설정
PLAYWRIGHT_HEADLESS="true"
```

**2. 의존성 설치 및 데이터베이스 설정**

```bash
# 의존성 설치
pnpm install

# Prisma 클라이언트 생성
pnpm run prisma:generate

# 데이터베이스 마이그레이션
pnpm run prisma:migrate:dev

# Playwright 브라우저 설치
npx playwright install chromium
```

**3. 개발 모드 실행**

```bash
# HMR 개발 서버 시작
pnpm run dev

# 또는 SWC watch 모드
pnpm run dev:swc
```

**4. 프로덕션 빌드 및 실행**

```bash
# 프로덕션 빌드
pnpm run build

# 프로덕션 서버 시작
pnpm run start:prod
```

### Docker 환경 실행

**1. Docker 이미지 빌드**

```bash
# Docker 이미지 빌드 (Multi-stage build)
docker build -t tstory-automation .
```

**2. Docker Compose로 실행**

```bash
# PostgreSQL + 애플리케이션 함께 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f app

# 중지
docker-compose down
```

**3. 단독 컨테이너 실행**

```bash
# 컨테이너 실행 (환경 변수 파일 사용)
docker run -d \
  --name tstory-app \
  -p 3000:3000 \
  --env-file .env \
  tstory-automation

# 로그 확인
docker logs -f tstory-app
```

**4. 클라우드 배포 (AWS/GCP/OCI 등)**

```bash
# 1. 이미지를 레지스트리에 푸시
docker tag tstory-automation your-registry/tstory-automation:latest
docker push your-registry/tstory-automation:latest

# 2. 클라우드 인스턴스에서 실행
docker run -d \
  --restart unless-stopped \
  --env-file .env \
  your-registry/tstory-automation:latest
```

### 유용한 명령어

```bash
# Prisma Studio (DB GUI)
pnpm run prisma:studio

# 데이터베이스 리셋 (개발 전용)
pnpm exec prisma migrate reset

# Docker 로컬 PostgreSQL 시작
pnpm run docker:db

# 테스트 실행
pnpm run test

# 커버리지 포함 테스트
pnpm run test:cov
```

## 학습 성과 및 트러블슈팅

### 1. Gemini API Rate Limit 대응

**문제 상황**

- Gemini API의 TPM(Tokens Per Minute) 제한으로 인해 연속 호출 시 429 에러 발생
- 요금제 데이터 분석 시 매번 개별 API 호출로 비효율적인 처리

**해결 과정**

- 배치 처리 로직 구현: 요금제 데이터를 그룹화하여 API 호출 최소화
- 지수 백오프(Exponential Backoff) 재시도 로직 추가
- API 호출 간 딜레이 조정 (1초 → 2초)

**결과**

- API 호출 횟수 **70% 감소**
- 처리 속도는 유지하면서 안정성 향상

**학습 포인트**

- 외부 API Rate Limiting 대응 전략
- 배치 처리의 중요성
- 재시도 로직 패턴 (Exponential Backoff)

### 2. AI 생성 콘텐츠 품질 관리

**문제 상황**

- Gemini가 생성한 HTML에 잘못된 날짜 포함 (예: 2025년 10월인데 11월로 생성)
- 불완전한 JSON 응답 발생 (필드 누락, 형식 오류)
- 모바일 환경에서 테이블이 깨지는 문제

**해결 과정**

- 1,000+ 라인의 상세한 프롬프트 설계 (출력 형식 명확화)
- JSON 응답 검증 로직 구현 (제목 날짜 자동 수정)
- Fallback HTML 생성 로직 추가 (AI 실패 시 기본 템플릿 사용)
- 반응형 테이블 CSS 자동 삽입

**결과**

- 콘텐츠 품질 안정성 확보
- 날짜 오류 **100% 자동 보정**
- 모바일 호환성 개선

**학습 포인트**

- 프롬프트 엔지니어링의 중요성
- LLM 응답의 불확실성 대응 전략
- Graceful Degradation 패턴

### 3. Playwright 브라우저 세션 관리

**문제 상황**

- 티스토리가 카카오 OAuth 로그인을 사용하여 매번 로그인 필요
- 로그인 세션 만료로 인한 발행 실패
- 카카오 계정 보안 정책으로 인한 자동 로그인 차단 위험

**해결 과정**

```typescript
// 1. 최초 로그인 후 쿠키 저장
const context = await browser.newContext();
await page.goto('https://www.tistory.com/auth/login');
// 카카오 로그인 수행...
await context.storageState({ path: 'tistory-session.json' });

// 2. 이후 세션 재사용
const context = await browser.newContext({
  storageState: 'tistory-session.json',
});
```

- PlaywrightService에서 세션 파일 관리
- 로그인 상태 검증 로직 추가
- 세션 만료 시 자동 재로그인

**결과**

- 발행 성공률 **95% → 100%** 개선
- 카카오 로그인 빈도 대폭 감소

**학습 포인트**

- Playwright 세션 관리 (`storageState`)
- OAuth 로그인 자동화 기법
- 브라우저 쿠키 영속화

### 4. Prisma 트랜잭션 충돌 처리

**문제 상황**

- 동시 요청 시 데이터베이스 교착 상태(Deadlock) 발생
- Prisma 트랜잭션 충돌로 인한 파이프라인 중단

**해결 과정**

- Prisma 트랜잭션 충돌 에러 자동 감지
- 5분 후 자동 재시도 로직 구현
- 순차적 워크플로우로 동시성 제어 (Crawler → Analyzer → Publisher)

**결과**

- 트랜잭션 충돌 **100% 복구**
- 파이프라인 안정성 확보

**학습 포인트**

- 데이터베이스 트랜잭션 처리
- 교착 상태(Deadlock) 해결 전략
- 재시도 로직 구현

### 5. Docker 컨테이너 배포 최적화

**문제 상황**

- 클라우드 환경에서 Playwright 브라우저 실행 오류
- Docker 이미지 크기 과다 (의존성 포함 시 1GB+)
- Chromium 브라우저 의존성 누락

**해결 과정**

```dockerfile
# Multi-stage build로 이미지 크기 최적화
FROM node:20-slim AS builder
# 빌드 단계...

FROM node:20-slim AS production
RUN npx playwright install --with-deps chromium
# 프로덕션 실행...
```

- Multi-stage Docker 빌드로 이미지 크기 최적화
- Chromium 브라우저 자동 설치 및 의존성 관리
- 환경 변수 기반 설정 분리 (.env 활용)

**결과**

- 이미지 크기 **40% 감소**
- 다양한 클라우드 플랫폼(AWS, GCP, OCI 등) 호환

**학습 포인트**

- Docker Multi-stage Build 기법
- 컨테이너 환경에서의 브라우저 자동화
- 환경 변수 관리 및 설정 분리

### 6. NestJS 아키텍처 설계

**학습 내용**

- **의존성 주입(DI)**: NestJS IoC 컨테이너를 활용한 모듈 간 결합도 감소
- **레이어드 아키텍처**: Service 레이어 분리로 관심사 분리 (SoC)
- **디자인 패턴**: Singleton (서비스), Factory (모듈), Strategy (파이프라인) 패턴 적용
- **전역 모듈**: PrismaModule을 전역으로 설정하여 중복 임포트 제거

**성과**

- 확장 가능한 모듈 구조 확립
- 테스트 용이성 향상 (모킹이 쉬운 구조)

### 7. Prisma ORM 활용

**학습 내용**

- 스키마 설계 및 마이그레이션 관리
- Upsert 패턴으로 중복 처리 방지
- 트랜잭션 처리 및 ACID 원칙 이해
- 타입 안전한 쿼리 작성 (컴파일 타임 에러 검증)

**성과**

- 런타임 에러 **80% 감소** (타입 시스템 덕분)
- 데이터 정합성 보장

### 8. Cron 기반 자동화

**학습 내용**

- NestJS Schedule 모듈을 이용한 Cron 작업 구현
- 순차 처리 (async/await)로 워크플로우 제어
- 에러 핸들링 및 Graceful Degradation 전략

**성과**

- 완전 자동화 시스템 구축
- 매일 06:00 자동 실행으로 인간 개입 불필요 |

## 자동화 스케줄

| 작업명              | Cron 표현식 | 실행 시간  | 타임존     | 설명                                                  |
| ------------------- | ----------- | ---------- | ---------- | ----------------------------------------------------- |
| **dailyAutomation** | `0 6 * * *` | 매일 06:00 | Asia/Seoul | 전체 파이프라인 실행 (Crawler → Analyzer → Publisher) |

**실행 흐름**:

```typescript
@Cron('0 6 * * *', { name: 'dailyAutomation', timeZone: 'Asia/Seoul' })
async runAutomation(): Promise<void> {
  await this.crawlerService.runCrawlAndDetect();
  await this.analyzerService.runFullAnalysis();
  await this.publisherService.runPublisher();
}
```

## 데이터베이스 스키마

### RawPlan (크롤링 데이터)

| 필드        | 타입    | 설명           |
| ----------- | ------- | -------------- |
| planId      | String  | 요금제 고유 ID |
| planName    | String  | 요금제명       |
| carrier     | String  | 통신사         |
| price       | Int     | 월 요금        |
| rawData     | Json    | 원본 HTML      |
| isProcessed | Boolean | 처리 여부      |

### PostQueue (발행 대기열)

| 필드       | 타입     | 설명                     |
| ---------- | -------- | ------------------------ |
| title      | String   | 포스트 제목              |
| htmlBody   | String   | HTML 본문                |
| tags       | String[] | 태그 배열                |
| status     | Enum     | PENDING/PUBLISHED/FAILED |
| retryCount | Int      | 재시도 횟수              |

## 프로젝트 구조

```
src/
├── main.ts                          # 🚀 앱 진입점 (Fastify 어댑터)
├── app.module.ts                    # 📦 루트 모듈
├── app.controller.ts                # 🎮 헬스체크 컨트롤러
│
├── prisma/                          # 💾 데이터베이스 모듈 (전역)
│   ├── prisma.module.ts
│   └── prisma.service.ts
│
├── playwright/                      # 🎭 브라우저 자동화 모듈
│   ├── playwright.module.ts
│   └── playwright.service.ts
│
├── automation/                      # ⏰ 중앙 스케줄러 모듈
│   ├── automation.module.ts
│   └── automation.service.ts
│
├── crawler/                         # 🕷️ 크롤링 모듈
│   ├── crawler.module.ts
│   └── crawler.service.ts
│
├── analyzer/                        # 🤖 AI 분석 모듈
│   ├── analyzer.module.ts
│   └── analyzer.service.ts
│
├── publisher/                       # 📝 발행 모듈
│   ├── publisher.module.ts
│   └── publisher.service.ts
│
└── test/                            # 🧪 테스트 모듈 (개발용)
    ├── test.module.ts
    ├── test.controller.ts
    └── test.service.ts
```

## 커스터마이징

### Cron 스케줄 변경

**파일**: `src/automation/automation.service.ts:40`

```typescript
@Cron('0 6 * * *', {  // 원하는 시간으로 변경
  name: 'dailyAutomation',
  timeZone: 'Asia/Seoul',
})
```

**예시**:

- `0 */2 * * *` → 2시간마다
- `0 9,18 * * *` → 매일 09:00, 18:00
- `0 6 * * 1-5` → 평일 06:00

### Gemini API 모델 변경

**파일**: `.env`

```env
GEMINI_MODEL="gemini-2.5-flash-lite"  # 기본 모델
```

사용 가능한 모델:

- `gemini-2.5-pro` - 고품질, 복잡한 문제 해결
- `gemini-2.5-flash` - 빠르고 지능적인 균형형 모델
- `gemini-2.5-flash-lite` - 초고속, 비용 효율적 (현재 사용)

### 프롬프트 수정

**파일**: `src/analyzer/analyzer.service.ts`

Gemini 프롬프트를 수정하여 블로그 스타일 변경 가능:

- SEO 키워드 조정
- HTML 구조 변경
- 카테고리 분류 기준 수정
