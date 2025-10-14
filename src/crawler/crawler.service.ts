import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page } from 'playwright';
import { PrismaService } from '@/prisma/prisma.service';
import { RawPlan } from '@prisma/client';

export interface CrawledPlan {
  planId: string;
  planName: string;
  carrier: string;
  dataAmount?: string;
  price?: number;
  promotionEndDate?: Date;
  rawData: any;
}

/**
 * 크롤러 서비스: Playwright를 사용한 웹 크롤링
 *
 * - Playwright는 Puppeteer보다 안정적인 Auto-Wait 기능 제공
 * - 크로스 브라우저 지원 및 향상된 네트워크 제어
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
   * OCI VM 제한된 리소스 환경에 최적화된 Playwright 실행 옵션
   *
   * - Playwright는 자동으로 브라우저를 설치하고 관리
   * - headless: 'new' 모드로 최신 헤드리스 브라우저 사용
   */
  private getLaunchOptions() {
    return {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
      ],
      // Playwright는 executablePath를 자동으로 관리
      // 필요시 환경 변수로 브라우저 경로 지정 가능
    };
  }

  /**
   * 브라우저 인스턴스 초기화
   *
   * - Playwright는 chromium, firefox, webkit 중 선택 가능
   * - 현재는 chromium 사용
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
   * 알뜰폰 요금제 비교 사이트 크롤링 및 데이터 추출
   *
   * - Playwright의 Auto-Wait 기능으로 안정적인 크롤링
   * - waitForSelector 자동 타임아웃 관리
   */
  async crawlPlans(): Promise<CrawledPlan[]> {
    const targetUrl = this.configService.get<string>('CRAWLER_TARGET_URL');
    if (!targetUrl) {
      throw new Error('CRAWLER_TARGET_URL이 설정되지 않았습니다');
    }

    this.logger.log(`크롤링 시작: ${targetUrl}`);
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      // 대상 URL로 이동
      // Playwright는 networkidle 대신 load, domcontentloaded 사용 권장
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      this.logger.log('페이지 로드 완료, 요금제 데이터 추출 중...');

      // TODO: 실제 웹사이트 구조에 맞게 셀렉터 커스터마이징 필요
      // 현재는 스켈레톤 구현
      const plans = await page.evaluate(() => {
        const planElements = document.querySelectorAll('.plan-item'); // 예시 셀렉터
        const results: any[] = [];

        planElements.forEach((element, index) => {
          const planName = element.querySelector('.plan-name')?.textContent?.trim() || '';
          const carrier = element.querySelector('.carrier')?.textContent?.trim() || '';
          const dataAmount = element.querySelector('.data-amount')?.textContent?.trim() || '';
          const priceText = element.querySelector('.price')?.textContent?.trim() || '';
          const price = parseInt(priceText.replace(/[^0-9]/g, '')) || 0;

          // 고유한 planId 생성 (실제 소스에 맞게 커스터마이징)
          const planId = `${carrier}-${planName}-${price}`.replace(/\s+/g, '-');

          if (planName && carrier) {
            results.push({
              planId,
              planName,
              carrier,
              dataAmount,
              price,
              promotionEndDate: null,
              rawData: {
                html: element.innerHTML,
                extractedAt: new Date().toISOString(),
              },
            });
          }
        });

        return results;
      });

      this.logger.log(`${plans.length}개 요금제 추출 완료`);
      return plans;
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
   * 크롤링된 요금제와 기존 DB 데이터를 비교하여 신규/변경 요금제만 반환
   */
  async detectChanges(crawledPlans: CrawledPlan[]): Promise<CrawledPlan[]> {
    this.logger.log('크롤링된 요금제 변경사항 감지 중...');

    const newOrChangedPlans: CrawledPlan[] = [];

    for (const plan of crawledPlans) {
      // 동일한 요금제가 이미 존재하는지 확인
      const existingPlan = await this.prisma.rawPlan.findFirst({
        where: {
          planName: plan.planName,
          carrier: plan.carrier,
          price: plan.price,
        },
      });

      if (!existingPlan) {
        // 신규 또는 변경된 요금제
        newOrChangedPlans.push(plan);
      }
    }

    this.logger.log(
      `총 ${crawledPlans.length}개 중 ${newOrChangedPlans.length}개 신규/변경 요금제 발견`,
    );
    return newOrChangedPlans;
  }

  /**
   * 신규 요금제를 데이터베이스에 저장 (upsert 방식)
   */
  async savePlans(plans: CrawledPlan[]): Promise<void> {
    this.logger.log(`${plans.length}개 요금제를 데이터베이스에 저장 중...`);

    for (const plan of plans) {
      try {
        await this.prisma.rawPlan.upsert({
          where: { planId: plan.planId },
          update: {
            planName: plan.planName,
            carrier: plan.carrier,
            dataAmount: plan.dataAmount,
            price: plan.price,
            promotionEndDate: plan.promotionEndDate,
            rawData: plan.rawData,
            crawledAt: new Date(),
          },
          create: {
            planId: plan.planId,
            planName: plan.planName,
            carrier: plan.carrier,
            dataAmount: plan.dataAmount,
            price: plan.price,
            promotionEndDate: plan.promotionEndDate,
            rawData: plan.rawData,
          },
        });
      } catch (error) {
        this.logger.error(`요금제 저장 실패: ${plan.planName}`, error);
      }
    }

    this.logger.log('요금제 저장 완료');
  }

  /**
   * 더미 크롤링 로직 (테스트용)
   * 실제 웹사이트 접속 없이 가상의 요금제 데이터를 생성합니다.
   * 실제 크롤링 로직으로 교체 시 crawlPlans() 메서드를 사용하세요.
   */
  async crawlPlansDemo(): Promise<CrawledPlan[]> {
    this.logger.log('더미 크롤링 시작 (테스트 데이터 생성)');

    // 가상의 알뜰폰 요금제 데이터
    const dummyPlans: CrawledPlan[] = [
      {
        planId: 'KT-알뜰-5GB-25000',
        planName: '알뜰 데이터 5GB',
        carrier: 'KT',
        dataAmount: '5GB',
        price: 25000,
        promotionEndDate: new Date('2025-12-31'),
        rawData: {
          source: 'dummy',
          extractedAt: new Date().toISOString(),
          description: '기본 통화 + 5GB 데이터',
        },
      },
      {
        planId: 'SKT-알뜰-10GB-35000',
        planName: '알뜰 데이터 10GB',
        carrier: 'SKT',
        dataAmount: '10GB',
        price: 35000,
        promotionEndDate: new Date('2025-12-31'),
        rawData: {
          source: 'dummy',
          extractedAt: new Date().toISOString(),
          description: '무제한 통화 + 10GB 데이터',
        },
      },
      {
        planId: 'LGU+-알뜰-20GB-45000',
        planName: '알뜰 데이터 20GB',
        carrier: 'LG U+',
        dataAmount: '20GB',
        price: 45000,
        promotionEndDate: new Date('2025-12-31'),
        rawData: {
          source: 'dummy',
          extractedAt: new Date().toISOString(),
          description: '무제한 통화 + 20GB 데이터',
        },
      },
      {
        planId: 'KT-알뜰-무제한-55000',
        planName: '알뜰 데이터 무제한',
        carrier: 'KT',
        dataAmount: '무제한',
        price: 55000,
        rawData: {
          source: 'dummy',
          extractedAt: new Date().toISOString(),
          description: '무제한 통화 + 무제한 데이터',
        },
      },
      {
        planId: 'SKT-알뜰-프리미엄-65000',
        planName: '알뜰 프리미엄',
        carrier: 'SKT',
        dataAmount: '무제한',
        price: 65000,
        rawData: {
          source: 'dummy',
          extractedAt: new Date().toISOString(),
          description: '무제한 통화 + 무제한 데이터 + 부가서비스',
        },
      },
    ];

    this.logger.log(`${dummyPlans.length}개 더미 요금제 생성 완료`);
    return dummyPlans;
  }

  /**
   * 크롤링 워크플로우 메인 메서드 (Upsert 방식)
   *
   * 동작 방식:
   * 1. 크롤링/더미 데이터 생성
   * 2. planId를 기준으로 Upsert (존재하면 업데이트, 없으면 삽입)
   * 3. 신규 또는 업데이트된 요금제 배열 반환
   *
   * @param useDemo true면 더미 데이터, false면 실제 크롤링
   * @returns Upsert된 요금제 데이터 배열
   */
  async runCrawlAndDetect(useDemo: boolean = true): Promise<RawPlan[]> {
    try {
      this.logger.log('크롤러 워크플로우 시작...');

      // 1. 크롤링 또는 더미 데이터 생성
      const crawledPlans = useDemo ? await this.crawlPlansDemo() : await this.crawlPlans();

      this.logger.log(`${crawledPlans.length}개 요금제 데이터 추출 완료`);

      // 2. Upsert: planId 기준으로 데이터 삽입/업데이트
      const upsertedPlans: RawPlan[] = [];

      for (const plan of crawledPlans) {
        try {
          const upsertedPlan = await this.prisma.rawPlan.upsert({
            where: {
              planId: plan.planId,
            },
            update: {
              planName: plan.planName,
              carrier: plan.carrier,
              dataAmount: plan.dataAmount,
              price: plan.price,
              promotionEndDate: plan.promotionEndDate,
              rawData: plan.rawData,
              crawledAt: new Date(),
              updatedAt: new Date(),
            },
            create: {
              planId: plan.planId,
              planName: plan.planName,
              carrier: plan.carrier,
              dataAmount: plan.dataAmount,
              price: plan.price,
              promotionEndDate: plan.promotionEndDate,
              rawData: plan.rawData,
              crawledAt: new Date(),
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
}
