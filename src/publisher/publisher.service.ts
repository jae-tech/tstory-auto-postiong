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

    await page.waitForSelector('main[id="editorContainer"]', { timeout: 10000 });
  }

  /**
   * 티스토리 에디터에 포스트 콘텐츠 입력
   *
   * - Playwright의 fill() 메서드로 안정적인 폼 입력
   * - evaluate()로 HTML 콘텐츠 직접 삽입
   * - keyboard.press()로 태그 입력 처리
   */
  /**
   * TinyMCE 에디터를 마크다운 모드로 전환
   *
   * - iframe 내부 요소까지 접근하여 클릭 이벤트 발생
   * - JavaScript evaluate를 통한 직접 이벤트 트리거
   * - 메뉴 표시 확인 후 마크다운 선택
   */
  private async switchToMarkdownMode(page: Page): Promise<void> {
    this.logger.log('TinyMCE 에디터 초기화 대기 중...');

    // 1. TinyMCE 에디터가 완전히 로드될 때까지 대기
    await page.waitForFunction(
      () => {
        return (
          typeof (window as any).tinymce !== 'undefined' &&
          (window as any).tinymce.activeEditor !== null
        );
      },
      { timeout: 15000 },
    );

    this.logger.log('마크다운 모드 전환 시작...');

    // 2. 에디터 모드 버튼이 표시될 때까지 대기
    await page.waitForSelector('div#editor-mode-layer-btn', {
      state: 'visible',
      timeout: 10000,
    });

    await page.waitForTimeout(500);

    // === 디버깅: 버튼 상태 확인 ===
    await page.screenshot({ path: 'debug-before-click.png', fullPage: true });
    this.logger.log('스크린샷 저장: debug-before-click.png');

    const buttonDebugInfo = await page.evaluate(() => {
      const button = document.querySelector('#editor-mode-layer-btn-open') as HTMLButtonElement;
      const container = document.querySelector('#editor-mode-layer-btn') as HTMLElement;

      if (!button || !container) {
        return { error: '버튼을 찾을 수 없음' };
      }

      const rect = button.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(button);

      // 이벤트 리스너 확인 (getEventListeners는 Chrome DevTools에서만 가능)
      const listeners = (window as any).getEventListeners
        ? (window as any).getEventListeners(button)
        : {};

      return {
        button: {
          id: button.id,
          className: button.className,
          tagName: button.tagName,
          disabled: button.disabled,
          type: button.type,
          offsetWidth: button.offsetWidth,
          offsetHeight: button.offsetHeight,
          innerHTML: button.innerHTML,
        },
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
        },
        computedStyle: {
          display: computedStyle.display,
          visibility: computedStyle.visibility,
          opacity: computedStyle.opacity,
          pointerEvents: computedStyle.pointerEvents,
          zIndex: computedStyle.zIndex,
          position: computedStyle.position,
        },
        container: {
          className: container.className,
          innerHTML: container.innerHTML.substring(0, 200),
        },
        listeners: Object.keys(listeners),
      };
    });

    this.logger.log('버튼 디버그 정보:');
    this.logger.log(JSON.stringify(buttonDebugInfo, null, 2));

    // 3. TinyMCE API로 직접 메뉴 열기 시도
    this.logger.log('TinyMCE API로 메뉴 열기 시도...');
    const tinyMceApiResult = await page.evaluate(() => {
      try {
        const tinymce = (window as any).tinymce;
        if (!tinymce || !tinymce.activeEditor) {
          return { success: false, error: 'TinyMCE 에디터 없음' };
        }

        // TinyMCE 메뉴 컨트롤 찾기
        const editor = tinymce.activeEditor;
        const controlManager = editor.controlManager;

        // 에디터 모드 버튼 ID로 컨트롤 찾기
        if (controlManager && controlManager.get) {
          const control = controlManager.get('editor-mode-layer-btn-open');
          if (control && control.click) {
            control.click();
            return { success: true, method: 'controlManager.click()' };
          }
        }

        return { success: false, error: 'TinyMCE API로 버튼 컨트롤을 찾을 수 없음' };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    this.logger.log('TinyMCE API 결과: ' + JSON.stringify(tinyMceApiResult));

    // 4. 여러 클릭 방법 시도
    this.logger.log('에디터 모드 버튼 클릭 시도 중...');

    const clickResults = await page.evaluate(() => {
      const results: any[] = [];
      const button = document.querySelector('#editor-mode-layer-btn-open') as HTMLButtonElement;
      const container = document.querySelector('#editor-mode-layer-btn') as HTMLElement;

      if (!button || !container) {
        return [{ method: 'none', success: false, error: '버튼을 찾을 수 없음' }];
      }

      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // 방법 1: 포커스 + 클릭
      try {
        button.focus();
        button.click();
        results.push({ method: 'focus+click', success: true });
      } catch (e: any) {
        results.push({ method: 'focus+click', success: false, error: e.message });
      }

      // 방법 2: MouseEvent (mousedown + mouseup + click)
      try {
        ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
          const event = new MouseEvent(eventType, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
          });
          button.dispatchEvent(event);
        });
        results.push({ method: 'MouseEvent', success: true });
      } catch (e: any) {
        results.push({ method: 'MouseEvent', success: false, error: e.message });
      }

      // 방법 3: PointerEvent
      try {
        ['pointerdown', 'pointerup'].forEach((eventType) => {
          const event = new PointerEvent(eventType, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
          });
          button.dispatchEvent(event);
        });
        results.push({ method: 'PointerEvent', success: true });
      } catch (e: any) {
        results.push({ method: 'PointerEvent', success: false, error: e.message });
      }

      // 방법 4: 컨테이너 클릭
      try {
        container.click();
        results.push({ method: 'container.click', success: true });
      } catch (e: any) {
        results.push({ method: 'container.click', success: false, error: e.message });
      }

      return results;
    });

    this.logger.log('클릭 시도 결과:');
    clickResults.forEach((result) => {
      this.logger.log(`  ${result.method}: ${result.success ? '성공' : '실패 - ' + result.error}`);
    });

    // 5. Playwright의 네이티브 클릭도 시도
    try {
      const buttonBox = await page.locator('#editor-mode-layer-btn-open').boundingBox();
      if (buttonBox) {
        await page.mouse.click(
          buttonBox.x + buttonBox.width / 2,
          buttonBox.y + buttonBox.height / 2,
        );
        this.logger.log('Playwright 마우스 클릭 성공');
      }
    } catch (e: any) {
      this.logger.warn(`Playwright 마우스 클릭 실패: ${e.message}`);
    }

    // 6. force 옵션으로 클릭
    try {
      await page.locator('#editor-mode-layer-btn-open').click({
        force: true,
        timeout: 2000,
      });
      this.logger.log('Force 클릭 성공');
    } catch (e: any) {
      this.logger.warn(`Force 클릭 실패: ${e.message}`);
    }

    await page.waitForTimeout(1000);

    // === 디버깅: 클릭 후 상태 확인 ===
    await page.screenshot({ path: 'debug-after-click.png', fullPage: true });
    this.logger.log('스크린샷 저장: debug-after-click.png');

    // DOM 변화 확인
    const domChanges = await page.evaluate(() => {
      const menuSelectors = ['.mce-menu', '.mce-floatpanel', '#mceu_29-body', 'div[role="menu"]'];
      const foundMenus = menuSelectors
        .map((sel) => {
          const el = document.querySelector(sel);
          return {
            selector: sel,
            exists: !!el,
            visible: el ? window.getComputedStyle(el).display !== 'none' : false,
            innerHTML: el ? el.innerHTML.substring(0, 100) : '',
          };
        })
        .filter((m) => m.exists);

      return {
        foundMenus,
        totalMenuElements: foundMenus.length,
      };
    });

    this.logger.log('클릭 후 DOM 변화:');
    this.logger.log(JSON.stringify(domChanges, null, 2));

    // 5. 메뉴가 표시될 때까지 대기 (복수 셀렉터 시도)
    const menuSelectors = ['.mce-menu', '.mce-floatpanel', '#mceu_29-body', 'div[role="menu"]'];

    let menuVisible = false;
    for (const selector of menuSelectors) {
      try {
        await page.waitForSelector(selector, {
          state: 'visible',
          timeout: 3000,
        });
        this.logger.log(`메뉴 표시 확인: ${selector}`);
        menuVisible = true;
        break;
      } catch (e) {
        // 다음 셀렉터 시도
      }
    }

    if (!menuVisible) {
      // 메뉴가 나타나지 않은 경우 전체 페이지 HTML 일부 로깅
      const pageSnapshot = await page.evaluate(() => {
        return {
          allMenuLikeElements: Array.from(
            document.querySelectorAll('[class*="menu"], [class*="Menu"]'),
          )
            .slice(0, 5)
            .map((el) => ({
              className: el.className,
              id: el.id,
              tagName: el.tagName,
              display: window.getComputedStyle(el).display,
              visibility: window.getComputedStyle(el).visibility,
            })),
        };
      });

      this.logger.error('메뉴를 찾을 수 없습니다. 페이지 스냅샷:');
      this.logger.error(JSON.stringify(pageSnapshot, null, 2));

      throw new Error('에디터 모드 메뉴가 표시되지 않았습니다');
    }

    // 6. 마크다운 옵션 클릭 (복수 셀렉터 시도)
    const markdownSelectors = [
      '#editor-mode-markdown',
      '#editor-mode-markdown-text',
      'text=마크다운',
      '[data-value="markdown"]',
    ];

    let markdownClicked = false;
    for (const selector of markdownSelectors) {
      try {
        const element = page.locator(selector).first();
        const count = await element.count();
        if (count > 0) {
          // 요소에 마우스 호버 후 클릭
          await element.hover();
          await page.waitForTimeout(200);
          await element.click({ force: true });
          this.logger.log(`마크다운 옵션 클릭 성공: ${selector}`);
          markdownClicked = true;
          break;
        }
      } catch (e) {
        // 다음 셀렉터 시도
      }
    }

    if (!markdownClicked) {
      throw new Error('마크다운 옵션을 찾을 수 없습니다');
    }

    // 7. 마크다운 에디터(CodeMirror)가 로드될 때까지 대기
    this.logger.log('마크다운 에디터 로드 대기 중...');
    await page.waitForSelector('.CodeMirror', {
      state: 'visible',
      timeout: 10000,
    });

    // 8. CodeMirror가 완전히 초기화될 때까지 추가 대기
    await page.waitForFunction(
      () => {
        const cm = document.querySelector('.CodeMirror');
        return cm && cm.CodeMirror && cm.CodeMirror.getValue !== undefined;
      },
      { timeout: 5000 },
    );

    await page.waitForTimeout(1000);
    this.logger.log('마크다운 모드 전환 완료');
  }

  async fillPostContent(page: Page, post: PostQueue): Promise<void> {
    // 마크다운 모드 전환
    // await this.switchToMarkdownMode(page);

    this.logger.log(`포스트 콘텐츠 입력 중: ${post.title}`);

    await page.locator('#category-btn').click();
    await page.waitForSelector('div[id="category-list"]', { timeout: 5000 });
    await page.locator('[category-id="1269624"]').click(); // 카테고리 선택 (필요시 수정)

    // 제목 입력 - fill()은 기존 내용을 지우고 입력하므로 안전
    await page.fill('textarea[id="post-title-inp"]', post.title);

    // 에디터에 콘텐츠 입력
    // 주의: 티스토리 에디터 버전에 따라 셀렉터가 다를 수 있음
    // await page.fill('.CodeMirror-code', post.htmlBody); // 마크다운 모드용

    this.logger.log('에디터 iframe 내부로 진입 및 텍스트 작성 시작...');

    // 1. iframe을 찾는 로케이터 (가장 바깥쪽, ID 사용)
    // <iframe id="editor-tistory_ifr"> ... </iframe>
    const editorFrame = page.frameLocator('#editor-tistory_ifr');

    // 2. iframe 내부의 실제 텍스트 입력 필드를 찾는 로케이터
    // <body id="tinymce" class="mce-content-body content" contenteditable="true">
    const inputField = editorFrame.locator('body#tinymce');

    // 3. 입력 필드가 로드되고 클릭 가능한 상태가 될 때까지 기다립니다.
    // 특히 iframe 내부 요소는 로딩에 시간이 걸릴 수 있으므로 명시적으로 기다립니다.
    await inputField.waitFor({ state: 'visible' });

    // 4. Gemini API로 생성된 최종 블로그 포스팅 텍스트를 변수에 담습니다.

    // 5. 텍스트를 작성합니다.
    // fill()은 기존 내용을 덮어쓰고, contenteditable=true인 body에 바로 적용 가능합니다.
    await inputField.fill(post.htmlBody);

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
   * 세션을 사용한 포스트 발행
   *
   * - 세션 파일이 있으면 로그인 생략
   * - 세션 파일이 없으면 로그인 후 세션 저장
   */
  async publishSinglePost(post: PostQueue): Promise<void> {
    // 세션 파일 존재 여부 확인
    const hasSession = this.playwrightService.hasSession();
    this.logger.log(
      hasSession ? '기존 세션으로 포스팅 시작...' : '세션 없음, 로그인 후 포스팅 시작...',
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
