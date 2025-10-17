import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Playwright 공통 서비스: 브라우저 인스턴스 및 컨텍스트 관리
 *
 * - 크롤러와 퍼블리셔에서 공통으로 사용하는 Playwright 로직 중앙화
 * - 브라우저 인스턴스 재사용으로 리소스 최적화
 * - 일관된 브라우저 설정 제공
 * - 세션 저장/복원으로 로그인 상태 유지
 *
 * 세션 파일 경로: sessions/tistory-session.json (프로젝트 루트)
 * .gitignore에 추가 필요: sessions/
 */
@Injectable()
export class PlaywrightService {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser: Browser | null = null;
  // 프로젝트 루트 기준 경로 (dev/prod 모드 모두 동일하게 동작)
  private readonly sessionPath = path.resolve(process.cwd(), 'sessions', 'tistory-session.json');

  constructor(private configService: ConfigService) {}

  /**
   * 세션 파일 존재 여부 확인
   */
  private sessionExists(): boolean {
    return fs.existsSync(this.sessionPath);
  }

  /**
   * 세션 파일 저장
   */
  private async saveSession(context: BrowserContext): Promise<void> {
    try {
      const sessionDir = path.dirname(this.sessionPath);

      // 세션 디렉토리가 없으면 생성
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const state = await context.storageState();
      fs.writeFileSync(this.sessionPath, JSON.stringify(state, null, 2));
      this.logger.log(`세션 저장 완료: ${this.sessionPath}`);
    } catch (error) {
      this.logger.error(`세션 저장 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 세션 파일 로드
   */
  private loadSession(): any {
    try {
      const sessionData = fs.readFileSync(this.sessionPath, 'utf-8');
      this.logger.log(`세션 로드 완료: ${this.sessionPath}`);
      return JSON.parse(sessionData);
    } catch (error) {
      this.logger.error(`세션 로드 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * OCI VM 및 Docker 환경에 최적화된 Playwright 실행 옵션
   */
  private getLaunchOptions() {
    return {
      headless: this.configService.get<string>('PLAYWRIGHT_HEADLESS') !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled',
      ],
    };
  }

  /**
   * 브라우저 인스턴스 가져오기
   *
   * - 기존 브라우저가 연결되어 있으면 재사용
   * - 연결이 끊어졌거나 없으면 새로 생성
   */
  async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.logger.log('새 Playwright 브라우저 인스턴스 실행 중...');
      this.browser = await chromium.launch(this.getLaunchOptions());
    }
    return this.browser;
  }

  /**
   * 브라우저 컨텍스트 생성
   *
   * - 독립적인 세션 관리 (쿠키, 로그인 상태 등 격리)
   * - 기본 뷰포트 및 User-Agent 설정
   * - 세션 복원 지원
   */
  async createContext(options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    useSession?: boolean;
  }): Promise<BrowserContext> {
    const browser = await this.getBrowser();

    const contextOptions: any = {
      viewport: options?.viewport || { width: 1920, height: 1080 },
      userAgent:
        options?.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    };

    // 세션 복원 옵션이 true이고 세션 파일이 존재하면 로드
    if (options?.useSession && this.sessionExists()) {
      this.logger.log('기존 세션 복원 중...');
      contextOptions.storageState = this.loadSession();
    }

    return await browser.newContext(contextOptions);
  }

  /**
   * 새 페이지 생성
   *
   * - 컨텍스트를 생성하고 페이지 반환
   * - 간단한 사용을 위한 헬퍼 메서드
   * - 자동화 감지 우회 스크립트 추가
   */
  async createPage(options?: {
    viewport?: { width: number; height: number };
    userAgent?: string;
    useSession?: boolean;
  }): Promise<{ page: Page; context: BrowserContext }> {
    const context = await this.createContext(options);
    const page = await context.newPage();

    // 자동화 감지 우회: navigator.webdriver를 false로 설정
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    return { page, context };
  }

  /**
   * 세션 저장 (외부에서 호출 가능)
   *
   * - 로그인 완료 후 세션을 저장하기 위해 사용
   */
  async saveContextSession(context: BrowserContext): Promise<void> {
    await this.saveSession(context);
  }

  /**
   * 세션 파일 존재 여부 확인 (외부에서 호출 가능)
   */
  hasSession(): boolean {
    return this.sessionExists();
  }

  /**
   * 세션 파일 삭제
   *
   * - 로그인 오류 시 세션을 초기화하기 위해 사용
   */
  deleteSession(): void {
    try {
      if (this.sessionExists()) {
        fs.unlinkSync(this.sessionPath);
        this.logger.log(`세션 삭제 완료: ${this.sessionPath}`);
      } else {
        this.logger.warn('삭제할 세션 파일이 존재하지 않습니다');
      }
    } catch (error) {
      this.logger.error(`세션 삭제 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 브라우저 인스턴스 종료
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.log('브라우저 종료');
    }
  }

  /**
   * 애플리케이션 종료 시 자동으로 브라우저 종료
   */
  async onModuleDestroy() {
    await this.closeBrowser();
  }
}
