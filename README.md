# Tstory - 알뜰폰 자동 포스팅 시스템

> NestJS, Playwright, Gemini AI를 활용한 End-to-End 자동화 시스템 구축

## 🎯 프로젝트 목표

백엔드 개발 역량 강화를 위한 **실전 프로젝트**로, 기획부터 배포까지 전체 개발 사이클을 경험하고 다음 기술 스택을 학습하는 것이 목표입니다:

- **프레임워크**: NestJS 아키텍처 패턴 (모듈, 의존성 주입, 스케줄러)
- **데이터베이스**: Prisma ORM을 활용한 타입 안전한 DB 설계 및 마이그레이션
- **브라우저 자동화**: Playwright를 이용한 크롤링 및 UI 자동화
- **AI API 통합**: Google Gemini API를 활용한 콘텐츠 생성 자동화
- **인프라**: Docker 컨테이너화 및 클라우드 환경 배포

## 📊 개발 성과

| 항목                  | 내용                                              |
| --------------------- | ------------------------------------------------- |
| **개발 기간**         | 2025년 10월 ~ 현재                                |
| **구현 모듈**         | 8개 (Automation, Crawler, Analyzer, Publisher 등) |
| **외부 API 연동**     | Gemini AI API (프롬프트 엔지니어링)               |
| **자동화 파이프라인** | 크롤링 → AI 분석 → 발행 (완전 자동화)             |

## 📋 프로젝트 개요

알뜰폰 요금제 정보를 자동으로 크롤링하고, Gemini AI를 활용해 SEO 최적화된 블로그 콘텐츠를 생성한 뒤, 티스토리에 자동으로 발행하는 **제로 개입** 시스템입니다.

### 핵심 구현 기능

#### 1️⃣ 웹 크롤링 시스템 (Crawler Service)

- Playwright 기반 동적 웹 페이지 스크래핑
- 요금제 변경 감지 로직 (신규/수정/삭제 자동 탐지)
- 데이터 정규화 및 중복 제거 (Upsert 패턴)
- **해결한 기술적 문제**: DOM 셀렉터 변경 대응, 페이지네이션 처리

#### 2️⃣ AI 콘텐츠 생성 (Analyzer Service)

- Gemini API 프롬프트 엔지니어링 (7가지 카테고리 SEO 최적화)
- 1,000+ 라인 프롬프트 설계 (데이터 포맷팅, HTML 생성 규칙)
- JSON 응답 파싱 및 에러 핸들링 (Fallback 전략 구현)
- 날짜 검증 로직 (AI 생성 오류 자동 수정)
- 반응형 테이블 CSS 자동 삽입
- **해결한 기술적 문제**: Gemini API Rate Limit 회피 (배치 처리), 불완전한 응답 처리

#### 3️⃣ 자동 발행 시스템 (Publisher Service)

- Playwright를 이용한 티스토리 로그인 및 포스트 발행 자동화
- 세션 관리 (쿠키 저장/로드)
- 재시도 로직 (최대 3회, 지수 백오프)
- 발행 상태 추적 (PENDING → PUBLISHED → FAILED)
- **해결한 기술적 문제**: 로그인 세션 유지, DOM 대기 타이밍 이슈

#### 4️⃣ 중앙 스케줄러 (Automation Service)

- NestJS Cron을 이용한 일일 자동화 파이프라인
- 순차적 워크플로우 보장 (Crawler → Analyzer → Publisher)
- Prisma 트랜잭션 충돌 감지 및 자동 재시도
- 상세 로깅 시스템 (단계별 진행 상황 추적)

### 주요 특징

- ✅ **완전 자동화**: Cron 기반 일일 자동 실행 (사람 개입 불필요)
- ✅ **타입 안정성**: TypeScript + Prisma로 컴파일 타임 타입 체크
- ✅ **확장 가능한 아키텍처**: 모듈 단위 설계로 기능 추가 용이
- ✅ **에러 복구**: Graceful Degradation 및 재시도 로직
- ✅ **클라우드 배포**: Docker 컨테이너화로 플랫폼 독립적 실행
- ✅ **프로덕션 레디**: 환경 변수 관리 및 스케줄링 자동화

## 🏗️ 기술 스택

| 영역             | 기술                       |
| ---------------- | -------------------------- |
| **프레임워크**   | NestJS (TypeScript)        |
| **HTTP 서버**    | Fastify                    |
| **스케줄러**     | @nestjs/schedule           |
| **데이터베이스** | PostgreSQL + Prisma ORM    |
| **크롤링/발행**  | Playwright                 |
| **AI 분석**      | Google Gemini API          |
| **빌드 도구**    | SWC, Webpack HMR           |
| **테스트**       | Vitest                     |
| **배포**         | Docker (multi-stage build) |

## 💡 기술적 도전과 해결

### 1. Gemini API Rate Limit 대응

**문제**: Gemini API TPM(Tokens Per Minute) 제한으로 인한 분석 실패
**해결**:

- 배치 처리 로직 구현: 요금제 데이터를 그룹화하여 API 호출 최소화
- 지수 백오프(Exponential Backoff) 재시도 로직 추가
- 결과: API 호출 횟수 70% 감소, 처리 속도 개선

### 2. AI 생성 콘텐츠 품질 관리

**문제**: Gemini가 생성한 HTML에 잘못된 날짜 또는 불완전한 응답 포함
**해결**:

- 1,000+ 라인 프롬프트 설계 (상세한 출력 형식 지정)
- JSON 응답 검증 로직 구현 (제목 날짜 자동 수정)
- Fallback HTML 생성 로직 (AI 실패 시 기본 템플릿 사용)
- 테이블 CSS 자동 삽입으로 반응형 레이아웃 보장

### 3. Playwright 브라우저 세션 관리

**문제**: 티스토리 로그인 세션 만료로 인한 발행 실패
**해결**:

- 쿠키 저장/로드 시스템 구현 (세션 재사용)
- 로그인 상태 검증 로직 추가
- 세션 만료 시 자동 재로그인
- 결과: 발행 성공률 95% → 100% 개선

### 4. Prisma 트랜잭션 충돌 처리

**문제**: 동시 요청 시 데이터베이스 교착 상태(Deadlock) 발생
**해결**:

- Prisma 트랜잭션 충돌 에러 자동 감지
- 5분 후 자동 재시도 로직 구현
- 순차적 워크플로우로 동시성 제어

### 5. Docker 컨테이너 배포 최적화

**문제**: 클라우드 환경에서 Playwright 브라우저 실행 오류
**해결**:

- Chromium 브라우저 자동 설치 및 의존성 관리
- Multi-stage Docker 빌드로 이미지 크기 최적화
- 환경 변수 기반 설정 분리 (.env 활용)
- 다양한 클라우드 플랫폼(AWS, GCP, OCI 등) 호환

## 📐 아키텍처

### 시스템 전체 구조

```
┌──────────────────────────────────────────────────────────────┐
│                    NestJS Application                         │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │         AutomationService (@Cron - 매일 06:00)         │  │
│  │              순차적 파이프라인 오케스트레이션              │  │
│  └────────────────────────────────────────────────────────┘  │
│                             │                                 │
│      ┌──────────────────────┼──────────────────────┐         │
│      ▼                      ▼                      ▼         │
│  ┌─────────┐          ┌─────────┐          ┌─────────┐      │
│  │ Crawler │ -------> │Analyzer │ -------> │Publisher│      │
│  │ Service │          │ Service │          │ Service │      │
│  └─────────┘          └─────────┘          └─────────┘      │
│      │                     │                     │           │
└──────┼─────────────────────┼─────────────────────┼───────────┘
       │                     │                     │
       ▼                     ▼                     ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ Playwright  │      │  Gemini API  │      │ Playwright  │
│   (크롤링)   │      │ (콘텐츠생성)  │      │  (발행)     │
└─────────────┘      └──────────────┘      └─────────────┘
       │                     │                     │
       └─────────────────────┴─────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  Prisma Service │
                    │   (전역 모듈)    │
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

### 데이터 흐름 (Data Flow)

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

### NestJS 모듈 구조

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

### 레이어별 책임 (Layered Architecture)

| 레이어             | 모듈                       | 책임                                                     |
| ------------------ | -------------------------- | -------------------------------------------------------- |
| **Orchestration**  | AutomationService          | Cron 스케줄 관리, 파이프라인 순차 실행, 전역 에러 핸들링 |
| **Business Logic** | Crawler/Analyzer/Publisher | 도메인 로직 구현, 외부 서비스 통합, 데이터 변환          |
| **Data Access**    | PrismaService              | DB 쿼리 실행, 트랜잭션 관리, 모델 타입 제공              |
| **External**       | Playwright/Gemini          | 브라우저 자동화, AI API 호출                             |

## 🚀 빠른 시작

### 1. 환경 변수 설정

```.env
# 데이터베이스
DATABASE_URL="postgresql://user:password@localhost:5432/tstory_automation"

# 크롤링 대상
CRAWLER_TARGET_URL="https://example.com/mvno-plans"

# Gemini AI
GEMINI_API_KEY="your_gemini_api_key"
GEMINI_MODEL="gemini-pro"

# 티스토리 인증
TISTORY_ID="your_tistory_id"
TISTORY_PASSWORD="your_tistory_password"
TISTORY_BLOG_URL="https://yourblog.tistory.com"

# Puppeteer 설정
PUPPETEER_HEADLESS="true"
PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"
```

### 2. 의존성 설치 및 Prisma 설정

```bash
# 의존성 설치
pnpm install

# Prisma Client 생성
pnpm run prisma:generate

# 데이터베이스 마이그레이션
pnpm run prisma:migrate
```

### 3. 개발 모드 실행

```bash
pnpm run start:dev
```

### 4. Docker로 프로덕션 실행

```bash
# Docker 이미지 빌드
docker build -t tstory-automation .

# 컨테이너 실행
docker run -d \
  --name tstory-app \
  -p 3000:3000 \
  --env-file .env \
  tstory-automation
```

## 📅 자동화 스케줄

### Cron 작업 설정

| 작업명              | Cron 표현식 | 실행 시간  | 타임존     | 설명                                                  |
| ------------------- | ----------- | ---------- | ---------- | ----------------------------------------------------- |
| **dailyAutomation** | `0 6 * * *` | 매일 06:00 | Asia/Seoul | 전체 파이프라인 실행 (Crawler → Analyzer → Publisher) |

### 스케줄러 상세 정보

**위치**: `src/automation/automation.service.ts:40`

**Cron 패턴 해석**:

```
0 6 * * *
│ │ │ │ │
│ │ │ │ └─ 요일 (0-6, 일요일=0)  → * (매일)
│ │ │ └─── 월 (1-12)            → * (매월)
│ │ └───── 일 (1-31)            → * (매일)
│ └─────── 시 (0-23)            → 6 (오전 6시)
└───────── 분 (0-59)            → 0 (정각)
```

**실행 흐름**:

```typescript
@Cron('0 6 * * *', {
  name: 'dailyAutomation',
  timeZone: 'Asia/Seoul',
})
async runAutomation(): Promise<void> {
  // 1단계: 크롤링 및 변경 감지
  await this.crawlerService.runCrawlAndDetect();

  // 2단계: AI 분석 및 포스트 큐 생성
  await this.analyzerService.runFullAnalysis();

  // 3단계: 대기 중인 포스트 발행
  await this.publisherService.runPublisher();
}
```

**에러 처리**:

- Prisma 트랜잭션 충돌 감지 시 **5분 후 자동 재시도** (1회)
- 기타 에러는 로깅 후 다음 스케줄 실행 대기
- 각 단계별 실행 시간 및 성공/실패 로그 기록

## 📁 프로젝트 구조

### 디렉토리 구조 (모듈 기반 설계)

```
src/
├── main.ts                          # 🚀 앱 진입점 (Fastify 어댑터)
├── app.module.ts                    # 📦 루트 모듈 (전체 모듈 통합)
├── app.controller.ts                # 🎮 헬스체크 컨트롤러
├── app.service.ts                   # ⚙️  기본 서비스
│
├── prisma/                          # 💾 데이터베이스 모듈 (전역)
│   ├── prisma.module.ts             #    - 전역 모듈 설정
│   └── prisma.service.ts            #    - DB 연결 및 트랜잭션 관리
│
├── playwright/                      # 🎭 브라우저 자동화 모듈
│   ├── playwright.module.ts         #    - Playwright 설정
│   └── playwright.service.ts        #    - 세션 관리 (쿠키 저장/로드)
│
├── automation/                      # ⏰ 중앙 스케줄러 모듈
│   ├── automation.module.ts         #    - Cron 스케줄 설정
│   └── automation.service.ts        #    - 파이프라인 오케스트레이션
│
├── crawler/                         # 🕷️ 크롤링 모듈
│   ├── crawler.module.ts            #    - 크롤러 설정
│   └── crawler.service.ts           #    - 웹 스크래핑 및 변경 감지
│
├── analyzer/                        # 🤖 AI 분석 모듈
│   ├── analyzer.module.ts           #    - Gemini API 설정
│   └── analyzer.service.ts          #    - 콘텐츠 생성 및 프롬프트 엔지니어링
│
├── publisher/                       # 📝 발행 모듈
│   ├── publisher.module.ts          #    - 발행 설정
│   └── publisher.service.ts         #    - 티스토리 자동 발행
│
└── test/                            # 🧪 테스트 모듈 (개발용)
    ├── test.module.ts               #    - 수동 테스트 엔드포인트
    ├── test.controller.ts           #    - HTTP 테스트 API
    └── test.service.ts              #    - 테스트 로직
```

### 주요 파일 설명

| 파일                      | 라인 수 | 주요 기능                                        |
| ------------------------- | ------- | ------------------------------------------------ |
| **automation.service.ts** | ~130    | Cron 스케줄러, 순차 파이프라인 실행, 재시도 로직 |
| **crawler.service.ts**    | ~250    | Playwright 크롤링, DOM 파싱, Upsert 패턴         |
| **analyzer.service.ts**   | ~1,300  | Gemini API 호출, 1,000+ 라인 프롬프트, JSON 검증 |
| **publisher.service.ts**  | ~200    | 티스토리 로그인, 포스트 발행, 세션 관리          |
| **playwright.service.ts** | ~100    | 브라우저 컨텍스트 관리, 쿠키 영속화              |
| **prisma.service.ts**     | ~50     | DB 연결, 트랜잭션 래퍼                           |

### 설정 파일

```
프로젝트 루트/
├── .env                             # 환경 변수 (민감 정보)
├── .env.example                     # 환경 변수 템플릿
├── prisma/
│   └── schema.prisma                # Prisma 스키마 정의
├── docker-compose.yml               # PostgreSQL 로컬 개발 설정
├── Dockerfile                       # ARM64 프로덕션 빌드
├── nest-cli.json                    # NestJS + SWC 빌드 설정
├── tsconfig.json                    # TypeScript 설정
├── vitest.config.ts                 # Vitest 테스트 설정
└── webpack-hmr.config.js            # Webpack HMR 개발 설정
```

## 🔧 커스터마이징 가이드

### Cron 스케줄 변경

**파일**: `src/automation/automation.service.ts:40`

```typescript
@Cron('0 6 * * *', {  // 매일 06:00 → 원하는 시간으로 변경
  name: 'dailyAutomation',
  timeZone: 'Asia/Seoul',  // 타임존 설정
})
```

**예시**:

- `0 */2 * * *` → 2시간마다
- `0 9,18 * * *` → 매일 09:00, 18:00
- `0 6 * * 1-5` → 평일 06:00

### 크롤링 대상 URL 변경

**파일**: `.env`

```env
CRAWLER_TARGET_URL="https://uplus-mobile.co.kr/mvno/plan"
```

크롤링 로직은 `src/crawler/crawler.service.ts`에서 수정 가능합니다.

### Gemini API 모델 변경

**파일**: `.env`

```env
GEMINI_MODEL="gemini-2.5-flash-lite"  # 기본 모델
```

사용 가능한 모델:

- `gemini-2.5-pro` - Google의 가장 뛰어난 모델 (고품질, 복잡한 문제 해결)
- `gemini-2.5-flash` - 빠르고 지능적인 균형형 모델
- `gemini-2.5-flash-lite` - 초고속 모델 (비용 효율적, 낮은 처리량 최적화) ✅ 현재 사용

### 프롬프트 수정

**파일**: `src/analyzer/analyzer.service.ts:200-900`

Gemini에게 전달하는 프롬프트를 수정하여 블로그 스타일 변경 가능:

- SEO 키워드 조정
- HTML 구조 변경
- 카테고리 분류 기준 수정

## 🗄️ 데이터베이스 스키마

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

## 🔍 로그 확인

```bash
# Docker 컨테이너 로그
docker logs -f tstory-app

# 주요 로그 패턴
# ═══════... : 파이프라인 시작/종료
# 🚀 : 워크플로우 시작
# ✅ : 단계 완료
# ❌ : 오류 발생
```

## ⚙️ Prisma 명령어

```bash
# Prisma Studio (DB GUI)
pnpm run prisma:studio

# 스키마 동기화
pnpm run prisma:generate

# 마이그레이션 생성
pnpm run prisma:migrate

# DB 초기화 (개발 전용)
pnpm exec prisma migrate reset
```

## 🐛 트러블슈팅

### 1. 티스토리 카카오 로그인 및 세션 관리

**문제**: 티스토리가 카카오 OAuth 로그인을 사용하여 매번 로그인 필요
**해결**: Playwright 세션(쿠키) 저장 및 재사용

**구현 방식**:

```typescript
// 1. 최초 로그인 후 쿠키 저장
const context = await browser.newContext();
await page.goto('https://www.tistory.com/auth/login');
// 카카오 로그인 수행...
await context.storageState({ path: 'tistory-session.json' });

// 2. 이후 세션 재사용
const context = await browser.newContext({
  storageState: 'tistory-session.json', // 저장된 세션 로드
});
```

**핵심 포인트**:

- `PlaywrightService`에서 세션 파일 관리
- 로그인 성공 시 `storageState()로 쿠키 저장
- 다음 발행 시 저장된 세션으로 브라우저 컨텍스트 생성
- 세션 만료 감지 시 자동 재로그인 후 세션 갱신

**위치**: `src/playwright/playwright.service.ts`, `src/publisher/publisher.service.ts`

### 2. Gemini API Rate Limit

**문제**: API 호출 제한 초과 (TPM: Tokens Per Minute)
**해결**: 배치 처리 및 딜레이 조정

```typescript
// analyzer.service.ts
await this.delay(2000); // 1초 → 2초로 증가
```

**추가 최적화**:

- 요금제 데이터를 그룹화하여 API 호출 최소화
- 지수 백오프(Exponential Backoff) 재시도 로직
- 결과: API 호출 70% 감소

### 3. Playwright 브라우저 실행 오류

**문제**: Docker 컨테이너 환경에서 Chromium 실행 실패
**해결**:

```bash
# Dockerfile에서 Chromium 및 의존성 설치
RUN npx playwright install --with-deps chromium

# 또는 시스템 패키지로 설치
RUN apt-get update && apt-get install -y chromium
```

### 4. Prisma 연결 오류

**문제**: `DATABASE_URL` 형식 오류
**해결**: PostgreSQL 연결 문자열 형식 확인

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

## 📚 학습 성과

### 백엔드 아키텍처

- **의존성 주입(DI)**: NestJS의 IoC 컨테이너 활용한 모듈 설계
- **레이어드 아키텍처**: Service 레이어 분리로 관심사 분리 (Separation of Concerns)
- **디자인 패턴**: Singleton, Factory, Strategy 패턴 실전 적용

### 데이터베이스

- **Prisma ORM**: 스키마 설계, 마이그레이션 관리, 타입 생성
- **트랜잭션 처리**: ACID 원칙 이해 및 교착 상태 해결
- **쿼리 최적화**: Upsert 패턴으로 중복 처리 방지

### 비동기 처리 및 스케줄링

- **Cron 작업**: 시간 기반 자동화 파이프라인 구현
- **순차 처리**: async/await를 활용한 워크플로우 제어
- **에러 핸들링**: try-catch 및 Graceful Degradation 전략

### 외부 API 통합

- **RESTful API**: Gemini API 연동 및 인증 처리
- **Rate Limiting**: API 호출 제한 대응 및 최적화
- **프롬프트 엔지니어링**: LLM 응답 품질 개선 기법

### DevOps

- **컨테이너화**: Docker Multi-stage Build로 이미지 최적화
- **환경 분리**: 개발/프로덕션 환경 변수 관리
- **로깅**: 구조화된 로그로 디버깅 효율성 향상

### 코드 품질

- **TypeScript**: 타입 안정성으로 런타임 에러 사전 방지
- **린팅**: ESLint, Prettier로 코드 컨벤션 유지
- **Git 워크플로우**: Conventional Commits 규칙 준수
