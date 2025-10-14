# Tstory - 알뜰폰 자동 포스팅 시스템

OCI Ampere A1 (ARM64) 환경에 최적화된 NestJS 기반 완전 자동화 포스팅 시스템

## 📋 프로젝트 개요

알뜰폰 요금제 정보를 자동으로 크롤링하고, Gemini AI를 활용해 블로그 콘텐츠를 생성한 뒤, 티스토리에 자동으로 발행하는 **제로 개입** 시스템입니다.

### 주요 특징
- ✅ **내부 Cron 스케줄러**: `@nestjs/schedule` 사용, 외부 Cron Job 불필요
- ✅ **ARM64 최적화**: OCI Ampere A1 Flex VM에서 네이티브 실행
- ✅ **Prisma ORM**: 타입 안전한 DB 작업
- ✅ **Puppeteer**: 무인 크롤링 및 자동 발행
- ✅ **Gemini AI**: 고품질 콘텐츠 자동 생성

## 🏗️ 기술 스택

| 영역 | 기술 |
|------|------|
| **프레임워크** | NestJS (TypeScript) |
| **HTTP 서버** | Fastify |
| **스케줄러** | @nestjs/schedule |
| **데이터베이스** | PostgreSQL + Prisma ORM |
| **크롤링/발행** | Puppeteer (ARM64) |
| **AI 분석** | Google Gemini API |
| **배포** | Docker (multi-stage build) |

## 📐 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│           AutomationService (@Cron)                     │
│              매일 새벽 3시 자동 실행                      │
└─────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Crawler    │  │   Analyzer   │  │  Publisher   │
│   Service    │  │   Service    │  │   Service    │
│ (Puppeteer)  │  │  (Gemini AI) │  │ (Puppeteer)  │
└──────────────┘  └──────────────┘  └──────────────┘
        │                │                │
        └────────────────┴────────────────┘
                        ▼
                ┌──────────────┐
                │   Prisma     │
                │ (PostgreSQL) │
                └──────────────┘
```

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
npm install

# Prisma Client 생성
npm run prisma:generate

# 데이터베이스 마이그레이션
npm run prisma:migrate
```

### 3. 개발 모드 실행

```bash
npm run start:dev
```

### 4. Docker로 프로덕션 실행

```bash
# Docker 이미지 빌드 (ARM64)
docker build -t tstory-automation .

# 컨테이너 실행
docker run -d \
  --name tstory-app \
  -p 3000:3000 \
  --env-file .env \
  tstory-automation
```

## 📅 자동화 스케줄

| 작업 | 스케줄 | 설명 |
|------|--------|------|
| **전체 파이프라인** | 매일 03:00 | 크롤링 → 분석 → 발행 |
| **발행 전용** | 2시간마다 | 대기 중인 포스트만 발행 |

스케줄 수정: `src/post-automation/automation.service.ts:31`

## 📁 프로젝트 구조

```
src/
├── main.ts                    # 앱 진입점 (Fastify)
├── app.module.ts              # 루트 모듈
├── prisma/                    # Prisma 모듈
│   ├── prisma.service.ts      # DB 연결 관리
│   └── prisma.module.ts       # 전역 모듈
└── post-automation/           # 자동화 모듈
    ├── post-automation.module.ts
    ├── automation.service.ts  # Cron 스케줄러 (심장부)
    ├── crawler.service.ts     # 크롤링 로직
    ├── analyzer.service.ts    # AI 분석 로직
    └── publisher.service.ts   # 티스토리 발행 로직
```

## 🔧 커스터마이징 가이드

### 크롤링 셀렉터 수정
`src/post-automation/crawler.service.ts:108-135`의 DOM 셀렉터를 실제 웹사이트 구조에 맞게 수정:

```typescript
const planElements = document.querySelectorAll('.plan-item'); // 수정 필요
const planName = element.querySelector('.plan-name')?.textContent; // 수정 필요
```

### 티스토리 발행 셀렉터 수정
`src/post-automation/publisher.service.ts:138-190`의 티스토리 UI 셀렉터 수정:

```typescript
await page.waitForSelector('input[name="title"]'); // 제목 입력 필드
await page.waitForSelector('.editor-content'); // 에디터 영역
```

### Cron 스케줄 변경
`src/post-automation/automation.service.ts:31`:

```typescript
@Cron('0 0 3 * * *')  // 매일 03:00 → 원하는 시간으로 변경
```

## 🗄️ 데이터베이스 스키마

### RawPlan (크롤링 데이터)
| 필드 | 타입 | 설명 |
|------|------|------|
| planId | String | 요금제 고유 ID |
| planName | String | 요금제명 |
| carrier | String | 통신사 |
| price | Int | 월 요금 |
| rawData | Json | 원본 HTML |
| isProcessed | Boolean | 처리 여부 |

### PostQueue (발행 대기열)
| 필드 | 타입 | 설명 |
|------|------|------|
| title | String | 포스트 제목 |
| htmlBody | String | HTML 본문 |
| tags | String[] | 태그 배열 |
| status | Enum | PENDING/PUBLISHED/FAILED |
| retryCount | Int | 재시도 횟수 |

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
npm run prisma:studio

# 스키마 동기화
npm run prisma:generate

# 마이그레이션 생성
npm run prisma:migrate

# DB 초기화 (개발 전용)
npx prisma migrate reset
```

## 🐛 트러블슈팅

### Puppeteer 오류

**문제**: Chromium을 찾을 수 없음
**해결**: Dockerfile에서 chromium 패키지 설치 확인

```dockerfile
RUN apt-get install -y chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Prisma 연결 오류

**문제**: `DATABASE_URL` 형식 오류
**해결**: PostgreSQL 연결 문자열 형식 확인

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

### Gemini API Rate Limit

**문제**: API 호출 제한 초과
**해결**: `analyzer.service.ts:183`의 딜레이 시간 조정

```typescript
await this.delay(2000); // 1초 → 2초로 증가
```

## 📜 라이선스

MIT License

## 🤝 기여

이슈 및 풀 리퀘스트 환영합니다!

---

**만든 이**: OCI Ampere A1에서 실행되는 완전 자동화 시스템
**스택**: NestJS + Prisma + Puppeteer + Gemini AI
**배포**: Docker (ARM64)
