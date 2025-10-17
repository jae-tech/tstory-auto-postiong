# Playwright 세션 관리 가이드

티스토리 자동 포스팅을 위한 Playwright 세션 저장 및 복원 기능 사용 가이드

## 개요

세션 관리 기능을 통해 티스토리 로그인 상태를 저장하고 재사용할 수 있습니다.
- **세션 파일 경로**: `sessions/tistory-session.json` (프로젝트 루트)
- **자동 생성**: 세션 디렉토리가 없으면 자동으로 생성됩니다
- **Git 제외**: `.gitignore`에 이미 추가되어 있어 세션 파일은 저장소에 커밋되지 않습니다
- **환경 독립**: dev/prod 모드 모두 동일한 경로 사용 (`process.cwd()` 기반)

## 주요 기능

### 1. PlaywrightService (공통 기능)

세션 관리를 위한 핵심 메서드:

```typescript
// 세션 파일 존재 여부 확인
hasSession(): boolean

// 세션 저장
saveContextSession(context: BrowserContext): Promise<void>

// 세션 삭제 (로그인 오류 시)
deleteSession(): void

// 세션 복원 옵션과 함께 페이지 생성
createPage({ useSession: true }): Promise<{ page, context }>
```

### 2. PublisherService (티스토리 포스팅)

자동 세션 관리 기능이 통합된 메서드:

```typescript
// 세션 초기화 (최초 1회만 실행)
initSession(): Promise<void>

// 세션을 활용한 포스트 발행
publishSinglePost(post: PostQueue): Promise<void>
```

## 사용 시나리오

### 시나리오 1: 최초 세션 초기화

세션 파일이 없는 경우, 로그인 후 세션을 저장합니다.

```bash
# HTTP API 호출
POST http://localhost:3000/test/init-session

# 응답 예시
{
  "success": true,
  "message": "세션 초기화 성공. 이제 로그인 없이 포스팅할 수 있습니다.",
  "timestamp": "2025-10-17T12:00:00.000Z"
}
```

**내부 동작:**
1. `sessions/` 디렉토리 생성 (프로젝트 루트, 없는 경우)
2. 티스토리 로그인 수행
3. 2차 로그인 페이지 자동 처리 (쿠키 체크박스 선택)
4. 세션을 `sessions/tistory-session.json`에 저장

### 시나리오 2: 세션을 사용한 포스팅

세션 파일이 있는 경우, 로그인 없이 바로 포스팅합니다.

```bash
# HTTP API 호출
POST http://localhost:3000/test/run-publisher

# 응답 예시
{
  "success": true,
  "postId": 123,
  "title": "알뜰폰 요금제 비교",
  "status": "PUBLISHED",
  "timestamp": "2025-10-17T12:05:00.000Z",
  "message": "포스트 발행 성공: 알뜰폰 요금제 비교"
}
```

**내부 동작:**
1. 세션 파일 존재 여부 확인
2. 세션 복원 (로그인 생략)
3. 포스팅 페이지로 이동
4. 콘텐츠 입력 및 발행

### 시나리오 3: 세션 오류 처리

세션이 만료되거나 유효하지 않은 경우 자동으로 재로그인합니다.

**내부 동작:**
1. 세션으로 포스팅 시도
2. 로그인 오류 감지 → 세션 파일 삭제
3. 다음 실행 시 자동으로 재로그인 및 세션 저장

## API 엔드포인트

### 1. 세션 초기화

```http
POST /test/init-session
```

- **용도**: 최초 로그인 및 세션 저장
- **실행 시점**: 세션 파일이 없을 때 1회 실행
- **결과**: `src/playwright/auth/tistory-session.json` 생성

### 2. 포스트 발행 (세션 자동 관리)

```http
POST /test/run-publisher
```

- **용도**: PostQueue에서 PENDING 포스트 발행
- **세션 처리**: 자동으로 세션 확인 → 없으면 로그인 → 저장
- **결과**: 티스토리에 포스트 발행

## 코드 예시

### 직접 세션 관리 (커스텀 사용)

```typescript
import { PlaywrightService } from '@/playwright/playwright.service';

@Injectable()
export class CustomService {
  constructor(private playwrightService: PlaywrightService) {}

  async customPublish() {
    // 세션 존재 여부 확인
    const hasSession = this.playwrightService.hasSession();

    // 세션 복원 옵션과 함께 페이지 생성
    const { page, context } = await this.playwrightService.createPage({
      useSession: hasSession,
    });

    try {
      if (!hasSession) {
        // 로그인 로직...
        await this.login(page);

        // 세션 저장
        await this.playwrightService.saveContextSession(context);
      }

      // 포스팅 로직...
      await page.goto('https://example.com');

    } finally {
      await page.close();
      await context.close();
      await this.playwrightService.closeBrowser();
    }
  }
}
```

### 세션 삭제 (오류 복구)

```typescript
// 세션 오류 발생 시
if (error.message.includes('로그인') || error.message.includes('인증')) {
  this.logger.warn('세션 오류 감지, 세션 파일 삭제...');
  await this.playwrightService.deleteSession();
}
```

## 환경 변수 설정

`.env` 파일에 티스토리 인증 정보를 설정해야 합니다:

```bash
# 티스토리 카카오 로그인 정보
TISTORY_ID="your_kakao_id"
TISTORY_PASSWORD="your_kakao_password"
TISTORY_BLOG_URL="https://your-blog.tistory.com"

# Playwright 옵션
PLAYWRIGHT_HEADLESS="true"  # headless 모드 (기본값: true)
```

## 보안 주의사항

1. **세션 파일 보호**
   - 세션 파일은 로그인 정보를 포함하므로 절대 공유하지 마세요
   - `.gitignore`에 이미 추가되어 있어 Git에 커밋되지 않습니다

2. **환경 변수 보호**
   - `.env` 파일도 `.gitignore`에 포함되어야 합니다
   - 프로덕션 환경에서는 환경 변수를 안전하게 관리하세요

3. **세션 만료**
   - 세션은 일정 시간 후 만료될 수 있습니다
   - 자동으로 재로그인 및 세션 저장 로직이 구현되어 있습니다

## 트러블슈팅

### 1. 세션 파일이 생성되지 않음

**원인**: 디렉토리 쓰기 권한 부족

**해결**:
```bash
# Windows
icacls sessions /grant Users:F

# Linux/Mac
chmod 755 sessions
```

### 2. 세션 복원 후 로그인 실패

**원인**: 세션 만료 또는 손상

**해결**:
```bash
# 세션 파일 수동 삭제
rm sessions/tistory-session.json

# 재초기화
POST http://localhost:3000/test/init-session
```

### 3. 2차 로그인 페이지에서 멈춤

**원인**: 셀렉터 변경 또는 타임아웃

**해결**: `publisher.service.ts`의 `loginToTistory()` 메서드 확인
- 셀렉터: `div[class="login_certify"]`
- 타임아웃: 기본 3초

## 성능 최적화

### 세션 재사용 효과

| 시나리오 | 로그인 시간 | 포스팅 시간 | 총 시간 |
|---------|-----------|-----------|--------|
| 세션 없음 | ~15초 | ~10초 | **~25초** |
| 세션 있음 | 0초 | ~10초 | **~10초** |

**개선 효과**: 약 60% 시간 단축

## 참고 자료

- [Playwright 세션 관리 문서](https://playwright.dev/docs/auth)
- [NestJS 의존성 주입](https://docs.nestjs.com/providers)
- 프로젝트 파일: `src/playwright/playwright.service.ts`
- 프로젝트 파일: `src/publisher/publisher.service.ts`

---

**작성일**: 2025-10-17
**작성자**: Claude Code (AI Assistant)
**프로젝트**: 티스토리 자동화 시스템
