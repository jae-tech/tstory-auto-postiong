import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page } from 'playwright';
import { PrismaService } from '@/prisma/prisma.service';
import { PostQueue, PostStatus } from '@prisma/client';

/**
 * 발행기 서비스: Playwright를 사용한 티스토리 자동 포스팅
 *
 * - Playwright는 안정적인 Auto-Wait 및 강력한 셀렉터 제공
 * - 타임아웃 관리가 Puppeteer보다 우수하여 발행 안정성 향상
 * - Context 기반 세션 관리로 쿠키/로그인 상태 유지 용이
 */
@Injectable()
export class PublisherService {
  private readonly logger = new Logger(PublisherService.name);
  private browser: Browser | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  /**
   * 티스토리 자동화를 위한 최적화된 Playwright 실행 옵션
   *
   * - Playwright는 headless 모드에서 더 안정적
   * - 자동 브라우저 다운로드 및 관리
   */
  private getLaunchOptions() {
    return {
      headless: this.configService.get<boolean>('PLAYWRIGHT_HEADLESS', true),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
    };
  }

  /**
   * 브라우저 인스턴스 가져오기
   *
   * - Playwright는 chromium, firefox, webkit 선택 가능
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.logger.log('새 Playwright 브라우저 인스턴스 실행 중...');
      this.browser = await chromium.launch(this.getLaunchOptions());
    }
    return this.browser;
  }

  /**
   * 브라우저 인스턴스 종료
   */
  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.logger.log('브라우저 종료');
    }
  }

  /**
   * 큐에서 다음 대기 중인 포스트 조회
   */
  async getNextPost(): Promise<PostQueue | null> {
    return await this.prisma.postQueue.findFirst({
      where: {
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * 티스토리 로그인
   *
   * - Playwright의 fill() 메서드로 안정적인 입력
   * - Auto-Wait로 자동 요소 대기
   */
  async loginToTistory(page: Page): Promise<void> {
    const tistoryId = this.configService.get<string>('TISTORY_ID');
    const tistoryPassword = this.configService.get<string>('TISTORY_PASSWORD');

    if (!tistoryId || !tistoryPassword) {
      throw new Error('TISTORY_ID 또는 TISTORY_PASSWORD가 설정되지 않았습니다');
    }

    this.logger.log('티스토리 로그인 중...');

    // 티스토리 로그인 페이지로 이동
    await page.goto('https://www.tistory.com/auth/login', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Playwright는 자동으로 요소를 기다리므로 별도의 waitForSelector 불필요
    // fill() 메서드는 type()보다 안정적
    await page.fill('input[name="loginId"]', tistoryId);
    await page.fill('input[name="password"]', tistoryPassword);

    // 로그인 버튼 클릭 및 네비게이션 대기
    // Promise.all로 동시 처리하여 안정성 향상
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);

    this.logger.log('티스토리 로그인 성공');
  }

  /**
   * 포스트 작성 페이지로 이동
   *
   * - Playwright의 waitForSelector는 자동으로 재시도
   */
  async navigateToWritePage(page: Page): Promise<void> {
    const blogUrl = this.configService.get<string>('TISTORY_BLOG_URL');
    if (!blogUrl) {
      throw new Error('TISTORY_BLOG_URL이 설정되지 않았습니다');
    }

    this.logger.log('작성 페이지로 이동 중...');

    await page.goto(`${blogUrl}/manage/newpost`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Playwright는 요소가 나타날 때까지 자동 대기
    await page.waitForSelector('.editor', { timeout: 10000 });
  }

  /**
   * 티스토리 에디터에 포스트 콘텐츠 입력
   *
   * - Playwright의 fill() 메서드로 안정적인 폼 입력
   * - evaluate()로 HTML 콘텐츠 직접 삽입
   * - keyboard.press()로 태그 입력 처리
   */
  async fillPostContent(page: Page, post: PostQueue): Promise<void> {
    this.logger.log(`포스트 콘텐츠 입력 중: ${post.title}`);

    // 제목 입력 - fill()은 기존 내용을 지우고 입력하므로 안전
    await page.fill('input[name="title"]', post.title);

    // HTML 모드로 전환 (필요시)
    const htmlModeButton = page.locator('button.html-mode');
    if ((await htmlModeButton.count()) > 0) {
      await htmlModeButton.click();
      await page.waitForTimeout(500);
    }

    // 에디터에 콘텐츠 입력
    // 주의: 티스토리 에디터 버전에 따라 셀렉터가 다를 수 있음
    const editorSelector = '.editor-content, .write-box, [contenteditable="true"]';
    await page.waitForSelector(editorSelector, { timeout: 10000 });

    // Playwright의 evaluate는 Puppeteer와 동일하게 작동
    await page.evaluate(
      ({ selector, content }) => {
        const editor = document.querySelector(selector);
        if (editor) {
          editor.innerHTML = content;
        }
      },
      { selector: editorSelector, content: post.htmlBody },
    );

    // 태그 입력 - Playwright의 keyboard API 사용
    if (post.tags && post.tags.length > 0) {
      const tagInput = page.locator('input[name="tag"]');
      if ((await tagInput.count()) > 0) {
        for (const tag of post.tags) {
          await tagInput.fill(tag);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(200);
        }
      }
    }

    this.logger.log('포스트 콘텐츠 입력 완료');
  }

  /**
   * 포스트 발행
   *
   * - Playwright의 locator로 강력한 셀렉터 사용
   * - text 셀렉터로 버튼 텍스트 기반 검색 가능
   */
  async publishPost(page: Page): Promise<void> {
    this.logger.log('포스트 발행 중...');

    // 발행/예약 버튼 찾기
    // Playwright는 text 셀렉터를 지원하여 더 안정적
    const publishButtonSelectors = [
      'button.btn-publish',
      'button.publish',
      'button:has-text("발행")',
      'text=발행',
    ];

    let clicked = false;
    for (const selector of publishButtonSelectors) {
      const button = page.locator(selector).first();
      if ((await button.count()) > 0) {
        await button.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      throw new Error('발행 버튼을 찾을 수 없습니다');
    }

    // 성공 확인 대기
    // Playwright는 여러 셀렉터를 동시에 대기 가능
    await page.locator('.success-message, .complete').first().waitFor({ timeout: 10000 });

    this.logger.log('포스트 발행 완료');
  }

  /**
   * 단일 포스트 발행을 위한 메인 자동화 흐름
   *
   * - Playwright Context를 사용한 세션 격리
   * - 자동 리소스 정리
   */
  async publishSinglePost(post: PostQueue): Promise<void> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      // 티스토리 로그인
      await this.loginToTistory(page);

      // 작성 페이지로 이동
      await this.navigateToWritePage(page);

      // 포스트 콘텐츠 입력
      await this.fillPostContent(page, post);

      // 포스트 발행
      await this.publishPost(page);

      // 데이터베이스 상태 업데이트
      await this.updatePostStatus(post.id, 'PUBLISHED', null);

      this.logger.log(`포스트 발행 성공 ID ${post.id}`);
    } catch (error) {
      this.logger.error(`포스트 발행 실패 ID ${post.id}:`, error);

      // 실패 로그와 함께 데이터베이스 업데이트
      await this.updatePostStatus(
        post.id,
        post.retryCount >= 3 ? 'FAILED' : 'PENDING',
        error.message,
      );

      throw error;
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
    }
  }

  /**
   * 데이터베이스에서 포스트 상태 업데이트 (Prisma 트랜잭션 사용)
   */
  async updatePostStatus(
    postId: number,
    status: PostStatus,
    failureLog: string | null,
  ): Promise<void> {
    await this.prisma.postQueue.update({
      where: { id: postId },
      data: {
        status,
        failureLog,
        retryCount: { increment: 1 },
        publishedAt: status === 'PUBLISHED' ? new Date() : undefined,
      },
    });
  }

  /**
   * 발행기 워크플로우 메인 메서드
   */
  async runPublisher(): Promise<{
    processed: number;
    success: boolean;
  }> {
    try {
      this.logger.log('발행기 워크플로우 시작...');

      const post = await this.getNextPost();

      if (!post) {
        this.logger.log('큐에 대기 중인 포스트 없음');
        return {
          processed: 0,
          success: true,
        };
      }

      await this.publishSinglePost(post);

      return {
        processed: 1,
        success: true,
      };
    } catch (error) {
      this.logger.error('발행기 워크플로우 실패:', error);
      throw error;
    }
  }

  /**
   * 딜레이 헬퍼 메서드
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
