# 프로젝트: 티스토리 자동화

AI 기반 알뜰폰 요금제 크롤링 및 자동 블로그 포스팅 시스템.

## 기술 스택

- **언어**: TypeScript 5.x
- **프레임워크**: NestJS 11.x (Fastify 어댑터)
- **데이터베이스**: PostgreSQL
- **ORM**: Prisma 6.x
- **자동화**: Playwright (브라우저 자동화)
- **AI 분석**: Google Gemini API
- **테스트**: Vitest (Jest 대체)
- **빌드**: SWC (고속 컴파일)
- **개발 도구**: Webpack HMR, Docker Compose

## 아키텍처 규칙

### 임포트 경로

- **모듈 간 참조**: `@/모듈명/파일명` 절대 경로 사용
- **로컬 파일**: 같은 디렉토리는 `./파일명` 상대 경로 사용

```typescript
// 모듈 간 참조
import { PrismaService } from '@/prisma/prisma.service';
import { CrawlerModule } from '@/crawler/crawler.module';

// 로컬 참조
import { AppController } from './app.controller';
import { AnalyzerService } from './analyzer.service';
```

### 중앙 제어

- 모든 파이프라인은 `AutomationService`를 통해 순차적으로 실행
- 각 단계는 `await`로 순서 보장: Crawler → Analyzer → Publisher
- 파이프라인 단계의 병렬 실행 금지

### 데이터베이스 접근

- 모든 DB 작업은 **반드시** `PrismaService`를 통해서만 수행
- Prisma Client로 모든 쿼리 실행
- 전역 모듈: 기능 모듈에서 PrismaModule 별도 임포트 불필요

### 컨트롤러

- 테스트용을 제외하고 **HTTP 컨트롤러 생성 금지**
- `TestController`는 수동 테스트용으로만 사용
- 프로덕션: Cron 기반 자동화, HTTP 엔드포인트 없음

## 디렉토리 구조

```
src/
├── automation/     # 중앙 스케줄러, 파이프라인 오케스트레이션
├── crawler/        # Playwright 크롤링, RawPlan upsert
├── analyzer/       # Gemini API 분석, PostQueue 생성
├── publisher/      # Playwright 발행, PostQueue 업데이트
├── prisma/         # Prisma Client 관리
└── test/           # 수동 테스트 엔드포인트 (개발용)
```

### 모듈 책임

- **automation**: Cron 작업, 순차 파이프라인 실행
- **crawler**: 웹 스크래핑, 변경 감지, RawPlan 저장
- **analyzer**: AI 콘텐츠 생성, PostQueue 엔트리 생성
- **publisher**: 브라우저 자동화, 티스토리 포스트 발행
- **prisma**: 데이터베이스 연결 및 트랜잭션 관리

## 주요 명령어

```bash
# 개발
pnpm run dev              # HMR 개발 서버 시작
pnpm run build            # SWC + 타입 체크 빌드

# 데이터베이스
pnpm run docker:db        # Docker에서 PostgreSQL 시작
pnpm run db:migrate:dev   # Prisma 마이그레이션 적용
pnpm run db:studio        # Prisma Studio 열기

# 테스트
pnpm run test             # 모든 테스트 실행
pnpm run test:watch       # Vitest 와치 모드
pnpm run test:cov         # 커버리지 리포트

# 프로덕션
pnpm run start:prod       # 프로덕션 서버 시작
```

## 코딩 가이드라인

### 서비스 패턴

```typescript
@Injectable()
export class ExampleService {
  private readonly logger = new Logger(ExampleService.name);

  constructor(private prisma: PrismaService) {}

  async process(): Promise<Result> {
    try {
      this.logger.log('처리 시작');
      // 구현
      return result;
    } catch (error) {
      this.logger.error('처리 실패:', error);
      throw error;
    }
  }
}
```

### Upsert 패턴

```typescript
const upserted = await this.prisma.model.upsert({
  where: { uniqueField: value },
  update: { /* 업데이트할 필드 */ },
  create: { /* 생성할 필드 */ },
});
```

### 트랜잭션 패턴

```typescript
await this.prisma.$transaction(async (tx) => {
  await tx.model1.create({ /* ... */ });
  await tx.model2.update({ /* ... */ });
});
```

## 환경 변수

`.env`에 필수 설정:

```bash
DATABASE_URL="postgresql://..."
GEMINI_API_KEY="..."
GEMINI_MODEL="gemini-2.5-flash-lite"
PLAYWRIGHT_HEADLESS="true"
TISTORY_ID="..."
TISTORY_PASSWORD="..."
TISTORY_BLOG_URL="..."
CRAWLER_TARGET_URL="..."
```

## 테스트 전략

- 모든 테스트에 Vitest 사용
- 테스트 파일: 소스 파일과 함께 `*.spec.ts` 배치
- 외부 서비스 모킹 (Playwright, Gemini API)
- 비즈니스 로직에 집중, 프레임워크 코드 테스트 제외

## 배포 주의사항

- 프로덕션에서 `TestModule` 제거 또는 가드 설정
- `NODE_ENV=production` 설정
- `AutomationService`에서 Cron 스케줄 구성
- Playwright 브라우저 설치 확인: `npx playwright install chromium`

## 공통 패턴

### Playwright 브라우저 설정

```typescript
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await context.newPage();
```

### 에러 처리

```typescript
try {
  // 작업 수행
} catch (error) {
  this.logger.error('작업 실패:', error);
  // Cron 작업에서는 throw 하지 않음 (스케줄러 계속 실행)
  // HTTP 엔드포인트에서는 throw로 적절한 에러 응답
}
```

### 로깅

```typescript
this.logger.log('정보 메시지');
this.logger.debug('디버그 상세 정보');
this.logger.warn('경고 메시지');
this.logger.error('에러 메시지', error);
```

## 파이프라인 흐름

1. **Crawler**: 웹사이트 스크래핑 → 변경 감지 → RawPlan Upsert
2. **Analyzer**: 미처리 RawPlan 조회 → Gemini API 호출 → PostQueue 생성
3. **Publisher**: 대기 중인 PostQueue 조회 → 브라우저 자동화 → 상태 업데이트

각 단계는 반드시 완료된 후 다음 단계로 진행.

## 커밋 컨벤션

### 커밋 메시지 형식

```
<타입>: <제목>

<본문 (선택사항)>
```

### 타입 (Type)

- **feat**: 새로운 기능 추가
- **fix**: 버그 수정
- **refactor**: 코드 리팩토링 (기능 변경 없음)
- **style**: 코드 포맷팅, 세미콜론 누락 등 (로직 변경 없음)
- **docs**: 문서 수정 (README, 주석 등)
- **test**: 테스트 코드 추가/수정
- **chore**: 빌드 설정, 패키지 업데이트 등
- **perf**: 성능 개선
- **build**: 빌드 시스템 또는 외부 종속성 변경
- **ci**: CI/CD 설정 파일 변경

### 제목 작성 규칙

- 50자 이내로 작성
- 첫 글자는 대문자로 시작 (한글의 경우 해당 없음)
- 마침표 사용 안 함
- 명령형으로 작성 ("추가함" 대신 "추가")
- 한글 또는 영어 사용 (프로젝트 내에서 일관성 유지)

### 본문 작성 규칙

- 제목과 본문 사이 빈 줄 추가
- 72자마다 줄바꿈
- "무엇을", "왜" 변경했는지 설명 ("어떻게"는 코드로 설명)
- 여러 이슈가 있을 경우 bullet point 사용

### 예시

```bash
# 기능 추가
feat: Gemini API 분석 기능 추가

analyzer 모듈에 Gemini API 연동 및 PostQueue 생성 로직 구현
- 요금제 데이터 기반 프롬프트 생성
- JSON 응답 파싱 및 검증
- 트랜잭션으로 원자성 보장

# 버그 수정
fix: Playwright 브라우저 연결 타임아웃 수정

크롤링 중 브라우저 연결이 끊어지는 문제 해결
- isConnected() 체크 추가
- 타임아웃을 15초에서 30초로 증가

# 리팩토링
refactor: 임포트 경로를 @/ 패턴으로 통일

모든 모듈 간 참조를 절대 경로로 변경하여 일관성 향상
- crawler, analyzer, publisher 모듈 수정
- 로컬 파일은 ./ 상대 경로 유지

# 설정 변경
chore: SWC 및 Webpack HMR 설정 추가

개발 환경 성능 개선을 위한 빌드 도구 업데이트
- nest-cli.json에 SWC 빌드 설정
- webpack-hmr.config.js 추가

# 문서 작성
docs: claude.md 프로젝트 가이드 추가

AI 에이전트를 위한 프로젝트 규칙 및 아키텍처 문서 작성

# 테스트 추가
test: crawler 서비스 단위 테스트 추가

crawlPlans 및 detectChanges 메서드 테스트 케이스 구현
```

### 주의사항

- 한 커밋에 하나의 논리적 변경만 포함
- 작업 중인 코드는 커밋하지 않음 (WIP 커밋 지양)
- 의미 있는 단위로 커밋 분리
- 민감한 정보(.env, 키 등) 커밋 금지
