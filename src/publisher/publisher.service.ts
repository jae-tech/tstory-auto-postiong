import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page } from 'playwright';
import { PrismaService } from '@/prisma/prisma.service';
import { PlaywrightService } from '@/playwright/playwright.service';
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

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private playwrightService: PlaywrightService,
  ) {}

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
   * - 2차 로그인 페이지 처리 (쿠키 없는 경우)
   */
  async loginToTistory(page: Page): Promise<void> {
    const tistoryId = this.configService.get<string>('TISTORY_ID');
    const tistoryPassword = this.configService.get<string>('TISTORY_PASSWORD');

    if (!tistoryId || !tistoryPassword) {
      throw new Error('TISTORY_ID 또는 TISTORY_PASSWORD가 설정되지 않았습니다');
    }

    this.logger.log('티스토리 로그인 중...');

    // 티스토리 로그인 페이지로 이동
    await page.goto('https://www.tistory.com', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await page.locator('a.btn_login.link_kakao_id').click();

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

    // 카카오 계정으로 로그인 버튼 클릭
    await page.locator('div.login_tistory > a.btn_login.link_kakao_id').click();

    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

    // 로그인 폼 입력
    await page.fill('input[name="loginId"]', tistoryId);
    await page.fill('input[name="password"]', tistoryPassword);

    await page.waitForTimeout(500);

    // 로그인 버튼 클릭
    await page.click('button[type="submit"]');

    // 로그인 후 2가지 시나리오 처리:
    // 1. 쿠키가 있는 경우: 바로 티스토리 메인으로 이동
    // 2. 쿠키가 없는 경우: 2차 로그인 페이지로 이동
    this.logger.log('로그인 후 페이지 확인 중...');

    try {
      // 2차 로그인 페이지 체크 (타임아웃 20초)
      await page.waitForSelector('p[class="desc_login"]', { timeout: 20000 });

      // 2차 로그인 페이지 로드 대기 (타임아웃 15초)
      await page.waitForSelector('button[name="user_oauth_approval"]', { timeout: 15000 });

      // 2차 로그인 버튼 클릭 및 네비게이션 대기
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        page.click('button[type="submit"]'),
      ]);

      this.logger.log('2차 로그인 완료');
    } catch (error) {
      // 2차 로그인 페이지가 나타나지 않으면 이미 로그인 성공
      this.logger.log('1차 로그인으로 성공 (2차 로그인 불필요)');
    }

    // 최종 로그인 성공 확인 (티스토리 메인 페이지 요소 확인)
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    this.logger.log('티스토리 로그인 성공');
  }

  /**
   * 포스트 작성 페이지로 이동
   *
   * - Playwright의 waitForSelector는 자동으로 재시도
   * - 세션 만료 시 로그인 페이지 리다이렉트 감지 및 재로그인
   */
  async navigateToWritePage(page: Page): Promise<boolean> {
    const blogUrl = this.configService.get<string>('TISTORY_BLOG_URL');
    if (!blogUrl) {
      throw new Error('TISTORY_BLOG_URL이 설정되지 않았습니다');
    }

    this.logger.log('작성 페이지로 이동 중...');

    await page.goto(`${blogUrl}/manage/newpost`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // 세션 만료 체크: 로그인 페이지로 리다이렉트되었는지 확인
    const currentUrl = page.url();

    // 로그인 페이지 패턴 체크
    const isLoginPage =
      currentUrl.includes('/login') ||
      currentUrl.includes('accounts.kakao.com') ||
      currentUrl.includes('kauth.kakao.com');

    if (isLoginPage) {
      this.logger.warn('세션 만료 감지: 로그인 페이지로 리다이렉트됨');
      return false; // 세션 만료됨
    }

    // 에디터 컨테이너가 있는지 확인
    try {
      await page.waitForSelector('main[id="editorContainer"]', { timeout: 10000 });
      this.logger.log('작성 페이지 로드 완료');
      return true; // 정상 로드
    } catch (error) {
      // 에디터가 로드되지 않았다면 로그인 페이지일 가능성
      const finalUrl = page.url();
      this.logger.warn(`에디터 컨테이너를 찾을 수 없음. 현재 URL: ${finalUrl}`);

      // 카카오 로그인 관련 요소 체크
      const hasLoginButton = (await page.locator('a.btn_login.link_kakao_id').count()) > 0;
      const hasKakaoLoginForm = (await page.locator('input[name="loginId"]').count()) > 0;

      if (hasLoginButton || hasKakaoLoginForm) {
        this.logger.warn('세션 만료 감지: 로그인 관련 요소 발견');
        return false; // 세션 만료됨
      }

      throw error; // 다른 문제
    }
  }

  async fillPostContent(page: Page, post: PostQueue): Promise<void> {
    this.logger.log(`포스트 콘텐츠 입력 중: ${post.title}`);

    // 더보기 클릭
    await page.locator('#more-plugin-btn-open').click();

    await page.waitForSelector('div[id^="mceu_"]');

    // HTML 블록 클릭
    await page.locator('div#plugin-html-block').click();

    // await page.waitForTimeout(3000000);
    // 입력
    const dialog = page.locator('.mce-codeblock-dialog-container');
    const editor = dialog.locator('.CodeMirror textarea');
    await editor.fill(post.htmlBody);
    // 확인
    await dialog.locator('.mce-codeblock-btn-submit button').click();

    // 카테고리 선택
    await page.locator('#category-btn').click();
    await page.locator('[category-id="1269624"]').click();

    // 제목 입력 - fill()은 기존 내용을 지우고 입력하므로 안전
    await page.fill('textarea[id="post-title-inp"]', post.title);

    // this.logger.log('에디터 iframe 내부로 진입 및 텍스트 작성 시작...');

    // 1. iframe을 찾는 로케이터 (가장 바깥쪽, ID 사용)
    // const editorFrame = page.frameLocator('#editor-tistory_ifr');

    // 2. iframe 내부의 실제 텍스트 입력 필드를 찾는 로케이터
    // <body id="tinymce" class="mce-content-body content" contenteditable="true">
    // const inputField = editorFrame.locator('body#tinymce');

    // 3. 입력 필드가 로드되고 클릭 가능한 상태가 될 때까지 기다립니다.
    // 특히 iframe 내부 요소는 로딩에 시간이 걸릴 수 있으므로 명시적으로 기다립니다.
    // await inputField.waitFor({ state: 'visible' });

    // 4. Gemini API로 생성된 최종 블로그 포스팅 텍스트를 변수에 담습니다.

    // 5. 텍스트를 작성합니다.
    // fill()은 기존 내용을 덮어쓰고, contenteditable=true인 body에 바로 적용 가능합니다.
    // await inputField.fill(post.htmlBody);

    this.logger.log('블로그 포스팅 텍스트 iframe 내부에 작성 완료.');

    // 태그 입력 - Playwright의 keyboard API 사용
    if (post.tags && post.tags.length > 0) {
      const tagInput = page.locator('input[name="tagText"]');
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
   */
  async publishPost(page: Page): Promise<void> {
    this.logger.log('포스트 발행 시작...');

    // 1. "완료" 버튼(발행 설정 레이어를 여는 버튼) 클릭
    const completeButton = page.locator('#publish-layer-btn');
    await completeButton.click();
    this.logger.log('발행 설정 레이어 오픈 완료');

    // 2. 발행 레이어 내부의 최종 '발행' 버튼 클릭
    // Tistory 레이어는 버튼의 텍스트가 '발행'입니다.
    const publishLayerButton = page.getByRole('button', { name: '발행' }).last();

    await publishLayerButton.waitFor({ state: 'visible', timeout: 5000 });
    await publishLayerButton.click();
    this.logger.log('최종 발행 버튼 클릭 완료');

    // -------------------------------------------------------------------
    // 3. ✨ 발행 성공 URL 확인 로직 (핵심)
    // -------------------------------------------------------------------
    const successUrlPattern = /\/manage\/posts\/?(\d+)?$/; // '/manage/posts' 또는 '/manage/posts/[Post ID]'

    try {
      await page.waitForURL(successUrlPattern, {
        // 15초 동안 URL이 패턴과 일치할 때까지 기다립니다.
        timeout: 15000,
      });

      // URL이 변경되었는지 최종 확인 (확인용)
      const currentUrl = page.url();
      if (successUrlPattern.test(currentUrl)) {
        this.logger.log(
          `✅ 포스트 발행 성공: URL이 관리 페이지 패턴과 일치합니다. (${currentUrl})`,
        );
      } else {
        // 이 블록은 waitForURL이 성공했기 때문에 실행될 가능성이 낮습니다.
        throw new Error(`발행 완료 후 URL 패턴 불일치: ${currentUrl}`);
      }
    } catch (error) {
      // 15초 내에 URL이 변경되지 않았거나 다른 문제가 발생한 경우
      this.logger.error(`❌ 포스트 발행 실패: URL 변경 시간 초과 또는 오류 발생. ${error.message}`);
      throw new Error('포스트 발행 후 URL 변경 감지 실패');
    }
  }

  /**
   * 세션 초기화: 로그인 후 세션 저장
   *
   * - 세션 파일이 없을 경우 로그인 수행
   * - 로그인 완료 후 세션 저장
   */
  async initSession(): Promise<void> {
    if (this.playwrightService.hasSession()) {
      this.logger.log('세션 파일이 이미 존재합니다. 초기화를 건너뜁니다.');
      return;
    }

    this.logger.log('세션 초기화 시작...');
    const { page, context } = await this.playwrightService.createPage();

    try {
      // 티스토리 로그인
      await this.loginToTistory(page);

      // 로그인 완료 후 세션 저장
      await this.playwrightService.saveContextSession(context);

      this.logger.log('세션 초기화 완료');
    } catch (error) {
      this.logger.error('세션 초기화 실패:', error);
      throw error;
    } finally {
      await page.close();
      await context.close();
      await this.playwrightService.closeBrowser();
    }
  }

  /**
   * 기존 포스트 수정 페이지로 이동
   */
  async navigateToEditPage(page: Page, postId: string): Promise<boolean> {
    const blogUrl = this.configService.get<string>('TISTORY_BLOG_URL');
    if (!blogUrl) {
      throw new Error('TISTORY_BLOG_URL이 설정되지 않았습니다');
    }

    this.logger.log(`기존 포스트 수정 페이지로 이동 중... (ID: ${postId})`);

    await page.goto(`${blogUrl}/manage/post/${postId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // 세션 만료 체크
    const currentUrl = page.url();
    const isLoginPage =
      currentUrl.includes('/login') ||
      currentUrl.includes('accounts.kakao.com') ||
      currentUrl.includes('kauth.kakao.com');

    if (isLoginPage) {
      this.logger.warn('세션 만료 감지: 로그인 페이지로 리다이렉트됨');
      return false;
    }

    // 에디터 컨테이너 확인
    try {
      await page.waitForSelector('main[id="editorContainer"]', { timeout: 10000 });
      this.logger.log('수정 페이지 로드 완료');
      return true;
    } catch (error) {
      const finalUrl = page.url();
      this.logger.warn(`에디터 컨테이너를 찾을 수 없음. 현재 URL: ${finalUrl}`);
      return false;
    }
  }

  /**
   * 세션을 사용한 포스트 발행/수정
   *
   * - 세션 파일이 있으면 로그인 생략
   * - 세션 파일이 없으면 로그인 후 세션 저장
   * - 세션 만료 감지 시 자동 재로그인
   * - NEW_POST: 신규 작성 / REVISION: 기존 글 수정
   */
  async publishSinglePost(post: PostQueue): Promise<void> {
    // 세션 파일 존재 여부 확인
    const hasSession = this.playwrightService.hasSession();
    const isRevision = post.postType === 'REVISION';

    this.logger.log(
      hasSession
        ? `기존 세션으로 ${isRevision ? '수정' : '발행'} 시작...`
        : `세션 없음, 로그인 후 ${isRevision ? '수정' : '발행'} 시작...`,
    );

    // 세션 복원 옵션을 포함하여 페이지 생성
    const { page, context } = await this.playwrightService.createPage({
      useSession: hasSession,
    });

    try {
      if (!hasSession) {
        // 세션이 없으면 로그인 수행
        await this.loginToTistory(page);

        // 로그인 완료 후 세션 저장
        await this.playwrightService.saveContextSession(context);
      }

      let isSessionValid: boolean;

      // 작성 또는 수정 페이지로 이동 (세션 만료 체크 포함)
      if (isRevision && post.originalPostId) {
        // 기존 포스트 수정
        isSessionValid = await this.navigateToEditPage(page, post.originalPostId);
      } else {
        // 신규 포스트 작성
        isSessionValid = await this.navigateToWritePage(page);
      }

      if (!isSessionValid) {
        // 세션 만료 감지 -> 기존 세션 삭제 후 재로그인
        this.logger.warn('세션이 만료되었습니다. 재로그인을 시도합니다...');

        await this.playwrightService.deleteSession();

        // 재로그인
        await this.loginToTistory(page);

        // 새 세션 저장
        await this.playwrightService.saveContextSession(context);

        // 작성/수정 페이지로 다시 이동
        if (isRevision && post.originalPostId) {
          isSessionValid = await this.navigateToEditPage(page, post.originalPostId);
        } else {
          isSessionValid = await this.navigateToWritePage(page);
        }

        if (!isSessionValid) {
          throw new Error('재로그인 후에도 페이지 접근 실패');
        }
      }

      // 포스트 콘텐츠 입력
      await this.fillPostContent(page, post);

      // 포스트 발행
      await this.publishPost(page);

      // 발행 성공 후 포스트 ID 추출 (신규 작성인 경우)
      let publishedPostId = post.originalPostId;

      if (!isRevision) {
        // 신규 작성 시 URL에서 포스트 ID 추출
        const currentUrl = page.url();
        const postIdMatch = currentUrl.match(/\/manage\/posts\/(\d+)/);
        if (postIdMatch) {
          publishedPostId = postIdMatch[1];
          this.logger.log(`신규 포스트 ID 추출: ${publishedPostId}`);
        }
      }

      // 데이터베이스 상태 업데이트
      await this.prisma.postQueue.update({
        where: { id: post.id },
        data: {
          status: 'PUBLISHED',
          originalPostId: publishedPostId,
          publishedAt: new Date(),
          retryCount: { increment: 1 },
        },
      });

      this.logger.log(
        `포스트 ${isRevision ? '수정' : '발행'} 성공 ID ${post.id} (티스토리 ID: ${publishedPostId})`,
      );
    } catch (error) {
      this.logger.error(`포스트 ${isRevision ? '수정' : '발행'} 실패 ID ${post.id}:`, error);

      // 세션 관련 오류인 경우 세션 삭제
      if (error.message.includes('로그인') || error.message.includes('인증')) {
        this.logger.warn('세션 오류 감지, 세션 파일 삭제...');
        await this.playwrightService.deleteSession();
      }

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
      await this.playwrightService.closeBrowser();
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
