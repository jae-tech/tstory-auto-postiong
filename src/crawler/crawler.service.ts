import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page } from 'playwright';
import { PrismaService } from '@/prisma/prisma.service';
import { RawPlan } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * 크롤링된 요금제 데이터 인터페이스
 */
export interface CrawledPlanData {
  planId: string;
  planName: string;
  mvno: string;
  network: string;
  technology: string;
  pricePromo: number;
  priceOriginal: number | null;
  promotionDurationMonths: number | null;
  promotionEndDate: Date | null;
  dataBaseGB: number;
  dataPostSpeedMbps: number | null;
  talkMinutes: number;
  smsCount: number;
  benefitSummary: string | null;
}

/**
 * 크롤러 서비스: Playwright를 사용한 알뜰폰 요금제 크롤링
 *
 * - 1시간마다 moyoplan.com에서 요금제 정보 수집
 * - 혜택 상세 정보 버튼을 모두 펼친 후 데이터 추출
 * - dataHash를 통한 변경 감지
 * - RawPlan 모델에 Upsert 저장
 */
@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private browser: Browser | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

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
      ],
    };
  }

  /**
   * 브라우저 인스턴스 가져오기
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
   * 요금제 데이터를 기반으로 해시 생성
   * 핵심 스펙 필드만 사용하여 변경 감지
   */
  private generateDataHash(plan: CrawledPlanData): string {
    const hashSource = [
      plan.planId,
      plan.pricePromo,
      plan.priceOriginal,
      plan.dataBaseGB,
      plan.dataPostSpeedMbps,
      plan.talkMinutes,
      plan.smsCount,
      plan.promotionDurationMonths,
      plan.technology,
    ].join('|');

    return crypto.createHash('sha256').update(hashSource).digest('hex');
  }

  /**
   * 문자열에서 숫자 추출 (예: "7,990원" -> 7990, "7개월 이후 38,500원" -> 38500)
   */
  private extractNumber(text: string): number {
    const cleaned = text.replace(/[^0-9]/g, '');
    return cleaned ? parseInt(cleaned, 10) : 0;
  }

  /**
   * 데이터량 텍스트를 GB 숫자로 변환
   * 예: "5GB" -> 5, "무제한" -> 999, "500MB" -> 0.5
   */
  private parseDataAmount(text: string): number {
    if (!text || text.includes('무제한')) return 999;

    const gbMatch = text.match(/(\d+(?:\.\d+)?)\s*GB/i);
    if (gbMatch) return parseFloat(gbMatch[1]);

    const mbMatch = text.match(/(\d+(?:\.\d+)?)\s*MB/i);
    if (mbMatch) return parseFloat(mbMatch[1]) / 1024;

    return 0;
  }

  /**
   * 통화/문자 제공량 파싱
   * 무제한은 9999로 반환
   */
  private parseUnlimitedOrNumber(text: string): number {
    if (!text) return 0;
    if (text.includes('무제한') || text.includes('기본제공')) return 9999;
    return this.extractNumber(text);
  }

  /**
   * 속도 제한 파싱 (예: "3Mbps" -> 3, "무제한" -> null)
   */
  private parseSpeed(text: string): number | null {
    if (!text || text.includes('무제한')) return null;
    const match = text.match(/(\d+(?:\.\d+)?)\s*Mbps/i);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * 할인 기간 파싱 (예: "7개월 이후" -> 7, "평생" -> 999)
   */
  private parsePromotionDuration(text: string): number | null {
    if (!text) return null;
    if (text.includes('평생') || text.includes('영구')) return 999;

    const match = text.match(/(\d+)\s*개월/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * moyoplan.com에서 알뜰폰 요금제 크롤링
   * 혜택 상세 정보 버튼을 모두 펼친 후 데이터 추출
   */
  async crawlPlans(): Promise<CrawledPlanData[]> {
    const targetUrl =
      this.configService.get<string>('CRAWLER_TARGET_URL') || 'https://www.moyoplan.com';

    this.logger.log(`크롤링 시작: ${targetUrl}`);
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    });

    // 데이터 피커 모달 방지 쿠키 설정
    await context.addCookies([
      {
        name: '_moyo_plans_filter_data_picker_saw',
        value: 'true',
        domain: 'www.moyoplan.com',
        path: '/',
        httpOnly: false,
        secure: false,
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 만료: +1일(초 단위)
      },
    ]);

    const page = await context.newPage();

    try {
      // 대상 URL로 이동
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // /plans 페이지로 이동
      await page.locator('a[href="/plans"]').first().click();

      this.logger.log('페이지 로드 완료, 요금제 카드 대기 중...');

      // 데이터 피커 모달이 나타나면 닫기
      if (await page.locator('div[data-sentry-component="PlansDataPickerModal"]').count()) {
        await page.locator('body').first().click();
      }

      // 요금제 카드가 로드될 때까지 대기
      await page.waitForSelector('div[class*="basic-plan-card"]', { timeout: 30000 });

      this.logger.log('요금제 카드 로드 완료, 상세 정보 버튼 펼치기 시작...');

      // ============================================================
      // 핵심 로직: 모든 혜택/상세 정보 버튼 펼치기
      // ============================================================

      // 모든 버튼이 'open' 상태가 될 때까지 기다리기
      await page.waitForFunction(
        () => {
          const buttons = page.locator('button[data-orientation="vertical"][data-state="closed"]');

          // 모든 버튼을 찾아서 동시에 클릭 시도 (force: true로 강제 클릭)
          const count = buttons.count();
          this.logger.log(`${count}개 버튼 발견, 순차 클릭 시작...`);

          for (let i = 0; i < count; i++) {
            buttons.nth(i).click({ force: true });
          }
          const allButtons = document.querySelectorAll('button[data-orientation="vertical"]');
          return Array.from(allButtons).every((btn) => btn.getAttribute('data-state') === 'open');
        },
        { timeout: 10000 },
      );

      this.logger.log('모든 상세 정보 버튼 펼치기 완료, 데이터 추출 중...');

      // ============================================================
      // 페이지에서 데이터 추출 (안정적인 Selector 사용)
      // ============================================================
      const plans = await page.evaluate(() => {
        const planElements = document.querySelectorAll(
          'div[class*="basic-plan-card_basicPlanCardBoxBase"]',
        );
        const results: any[] = [];

        planElements.forEach((el) => {
          try {
            // ============================================================
            // 1. mvno (사업자명) 추출: img 태그의 alt 속성
            // ============================================================
            const imgElement = el.querySelector('img[alt]');
            const mvno = imgElement?.getAttribute('alt') || 'Unknown';

            // ============================================================
            // 2. planId 추출: a 태그의 href에서 마지막 숫자
            // ============================================================
            const linkElement = el.querySelector('a[href^="/plans/"]');
            const href = linkElement?.getAttribute('href') || '';
            const planId = href.split('/').pop() || '0';

            // ============================================================
            // 3. planName (요금제 이름) 추출
            // - 구조: a > div > div > div > div > span (3번째 span)
            // ============================================================
            const allSpans = Array.from(el.querySelectorAll('a span'));
            const planName = allSpans[2]?.textContent?.trim() || 'Unknown';

            // ============================================================
            // 4. dataSummary 추출: Bold 스타일의 큰 텍스트
            // - "월 11GB + 매일 2GB + 3Mbps" 형태
            // ============================================================
            const boldSpans = Array.from(el.querySelectorAll('span'));
            const dataSummary =
              boldSpans
                .find((span) => {
                  const text = span.textContent || '';
                  return text.includes('GB') || text.includes('Mbps');
                })
                ?.textContent?.trim() || '';

            // ============================================================
            // 5. promoPrice (현재가) 추출: "월 12,000원"
            // - 색상이 강조된 span (indigo600)
            // ============================================================
            const promoPriceSpans = Array.from(el.querySelectorAll('span'));
            const promoPriceText =
              promoPriceSpans
                .find((span) => {
                  const text = span.textContent || '';
                  return text.includes('월') && text.includes('원') && !text.includes('이후');
                })
                ?.textContent?.trim() || '0';

            // ============================================================
            // 6. originalPrice 및 promoDuration 추출: "7개월 이후 38,500원"
            // ============================================================
            const allTextSpans = Array.from(el.querySelectorAll('span'));
            const originalPriceText =
              allTextSpans
                .find((span) => {
                  const text = span.textContent || '';
                  return text.includes('개월 이후');
                })
                ?.textContent?.trim() || '';

            // ============================================================
            // 7. 통신 스펙 추출: 통화, 문자, 통신망, 기술
            // - gap_12 클래스를 가진 div 내의 span들을 순서대로 추출
            // ============================================================
            const specsContainer = Array.from(el.querySelectorAll('div')).find((div) => {
              const className = div.className || '';
              return className.includes('gap_12') && div.children.length >= 4;
            });

            const specsSpans = specsContainer
              ? Array.from(specsContainer.querySelectorAll('span'))
              : [];

            // 구분선(verticalDivider)을 제외한 텍스트만 추출
            const specsTexts = specsSpans
              .map((span) => span.textContent?.trim())
              .filter((text) => text && text.length > 0);

            const talkText = specsTexts[0] || '';
            const smsText = specsTexts[1] || '';
            const networkText = specsTexts[2] || '';
            const technologyText = specsTexts[3] || '';

            // ============================================================
            // 8. 혜택 정보 (펼쳐진 상태에서 추출)
            // ============================================================
            const benefitsButton = el.querySelector(
              'button[data-orientation="vertical"][data-state="open"]',
            );
            const benefits = benefitsButton?.getAttribute('aria-label') || '';

            // ============================================================
            // 9. 결과 추가
            // ============================================================
            if (planName && mvno && planId !== '0') {
              results.push({
                planId,
                planName,
                mvno,
                dataSummary,
                promoPriceText,
                originalPriceText,
                talkText,
                smsText,
                networkText,
                technologyText,
                benefits,
              });
            }
          } catch (error) {
            console.error('요금제 카드 파싱 오류:', error);
          }
        });

        return results;
      });

      this.logger.log(`${plans.length}개 요금제 추출 완료`);

      // ============================================================
      // 추출된 데이터를 CrawledPlanData 형식으로 변환
      // ============================================================
      const crawledPlans: CrawledPlanData[] = plans.map((plan) => {
        // 1. mvno: 사업자명 (이미 추출됨)
        const mvno = plan.mvno;

        // 2. planName: 요금제 이름 (이미 추출됨)
        const planName = plan.planName;

        // 3. planId: 요금제 고유 ID (이미 추출됨)
        const planId = plan.planId;

        // 4. network: 통신망 (예: "KT망", "SKT망", "LG U+망")
        const network = plan.networkText || 'Unknown';

        // 5. technology: 기술 (예: "LTE", "5G")
        const technology = plan.technologyText || 'LTE';

        // 6. pricePromo: 현재 할인가 (예: "월 12,000원" -> 12000)
        const pricePromo = this.extractNumber(plan.promoPriceText);

        // 7. priceOriginal: 할인 전 원가 (예: "7개월 이후 38,500원" -> 38500)
        const priceOriginal = plan.originalPriceText
          ? this.extractNumber(plan.originalPriceText)
          : null;

        // 8. promotionDurationMonths: 할인 기간 (예: "7개월 이후" -> 7)
        const promotionDurationMonths = this.parsePromotionDuration(plan.originalPriceText || '');

        // 9. promotionEndDate: 종료일 (명시적으로 제공되지 않으면 null)
        const promotionEndDate = null;

        // 10. dataBaseGB: 기본 데이터량 (예: "월 11GB" -> 11)
        const dataBaseGB = this.parseDataAmount(plan.dataSummary);

        // 11. dataPostSpeedMbps: 소진 후 속도 (예: "3Mbps" -> 3)
        const dataPostSpeedMbps = this.parseSpeed(plan.dataSummary);

        // 12. talkMinutes: 통화 제공량 (예: "통화 무제한" -> 9999)
        const talkMinutes = this.parseUnlimitedOrNumber(plan.talkText);

        // 13. smsCount: 문자 제공량 (예: "문자 무제한" -> 9999)
        const smsCount = this.parseUnlimitedOrNumber(plan.smsText);

        // 14. benefitSummary: 혜택 요약
        const benefitSummary = plan.benefits || null;

        return {
          planId,
          planName,
          mvno,
          network,
          technology,
          pricePromo,
          priceOriginal,
          promotionDurationMonths,
          promotionEndDate,
          dataBaseGB,
          dataPostSpeedMbps,
          talkMinutes,
          smsCount,
          benefitSummary,
        };
      });

      return crawledPlans;
    } catch (error) {
      this.logger.error('크롤링 실패:', error);
      throw error;
    } finally {
      await page.close();
      await context.close();
      await this.closeBrowser();
    }
  }

  /**
   * 더미 크롤링 로직 (테스트용)
   */
  async crawlPlansDemo(): Promise<CrawledPlanData[]> {
    this.logger.log('더미 크롤링 시작 (테스트 데이터 생성)');

    const dummyPlans: CrawledPlanData[] = [
      {
        planId: '29214',
        planName: '[모요핫딜]음성기본 11GB+일 2GB+',
        mvno: '찬스모바일',
        network: 'LG U+망',
        technology: 'LTE',
        pricePromo: 12000,
        priceOriginal: 38500,
        promotionDurationMonths: 7,
        promotionEndDate: null,
        dataBaseGB: 11,
        dataPostSpeedMbps: 3,
        talkMinutes: 9999,
        smsCount: 9999,
        benefitSummary: '7개월 할인, 기본 통화 + 11GB 데이터',
      },
      {
        planId: '12345',
        planName: '알뜰 5G 무제한',
        mvno: '유모바일',
        network: 'SKT망',
        technology: '5G',
        pricePromo: 35000,
        priceOriginal: 40000,
        promotionDurationMonths: 12,
        promotionEndDate: null,
        dataBaseGB: 999,
        dataPostSpeedMbps: null,
        talkMinutes: 9999,
        smsCount: 9999,
        benefitSummary: '12개월 할인, 무제한 통화 + 무제한 데이터',
      },
      {
        planId: '67890',
        planName: '프리티 프리미엄',
        mvno: '프리티',
        network: 'KT망',
        technology: '5G',
        pricePromo: 55000,
        priceOriginal: null,
        promotionDurationMonths: null,
        promotionEndDate: null,
        dataBaseGB: 999,
        dataPostSpeedMbps: null,
        talkMinutes: 9999,
        smsCount: 9999,
        benefitSummary: '무제한 통화 + 무제한 데이터',
      },
    ];

    this.logger.log(`${dummyPlans.length}개 더미 요금제 생성 완료`);
    return dummyPlans;
  }

  /**
   * 크롤링 및 DB 저장 메인 메서드
   *
   * @param useDemo true면 더미 데이터, false면 실제 크롤링
   * @returns Upsert된 요금제 데이터 배열
   */
  async crawlAndSavePlans(useDemo = true): Promise<RawPlan[]> {
    try {
      this.logger.log('크롤러 워크플로우 시작...');

      // 1. 크롤링 또는 더미 데이터 생성
      const crawledPlans = useDemo ? await this.crawlPlansDemo() : await this.crawlPlans();

      this.logger.log(`${crawledPlans.length}개 요금제 데이터 추출 완료`);

      // 2. Upsert: planId 기준으로 데이터 삽입/업데이트
      const upsertedPlans: RawPlan[] = [];

      for (const plan of crawledPlans) {
        try {
          // dataHash 생성
          const dataHash = this.generateDataHash(plan);

          const upsertedPlan = await this.prisma.rawPlan.upsert({
            where: {
              planId: plan.planId,
            },
            update: {
              dataHash,
              mvno: plan.mvno,
              network: plan.network,
              technology: plan.technology,
              pricePromo: plan.pricePromo,
              priceOriginal: plan.priceOriginal,
              promotionDurationMonths: plan.promotionDurationMonths,
              promotionEndDate: plan.promotionEndDate,
              dataBaseGB: plan.dataBaseGB,
              dataPostSpeedMbps: plan.dataPostSpeedMbps,
              talkMinutes: plan.talkMinutes,
              smsCount: plan.smsCount,
              benefitSummary: plan.benefitSummary,
              updatedAt: new Date(),
            },
            create: {
              planId: plan.planId,
              dataHash,
              mvno: plan.mvno,
              network: plan.network,
              technology: plan.technology,
              pricePromo: plan.pricePromo,
              priceOriginal: plan.priceOriginal,
              promotionDurationMonths: plan.promotionDurationMonths,
              promotionEndDate: plan.promotionEndDate,
              dataBaseGB: plan.dataBaseGB,
              dataPostSpeedMbps: plan.dataPostSpeedMbps,
              talkMinutes: plan.talkMinutes,
              smsCount: plan.smsCount,
              benefitSummary: plan.benefitSummary,
            },
          });

          upsertedPlans.push(upsertedPlan);
          this.logger.debug(`Upsert 완료: ${upsertedPlan.planId}`);
        } catch (error) {
          this.logger.error(`Upsert 실패: ${plan.planId}`, error);
        }
      }

      this.logger.log(`크롤러 워크플로우 완료: ${upsertedPlans.length}개 요금제 처리됨`);

      return upsertedPlans;
    } catch (error) {
      this.logger.error('크롤러 워크플로우 실패:', error);
      throw error;
    }
  }

  /**
   * 이전 메서드와의 호환성을 위한 별칭
   */
  async runCrawlAndDetect(useDemo = true): Promise<RawPlan[]> {
    return this.crawlAndSavePlans(useDemo);
  }
}
