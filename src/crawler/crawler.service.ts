import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { PlaywrightService } from '@/playwright/playwright.service';
import { RawPlan } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * 크롤링된 요금제 데이터 인터페이스
 */
export interface CrawledPlanData {
  planName: string;
  sourceSite: string; // 크롤링 출처 사이트 (예: "moyoplan", "mvnohub")
  detailUrl: string | null; // 요금제 상세 페이지 URL
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

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private playwrightService: PlaywrightService,
  ) {}

  /**
   * 요금제 데이터를 기반으로 해시 생성
   * 핵심 스펙 필드만 사용하여 변경 감지 (planId 제거, sourceSite와 planName 조합 사용)
   */
  private generateDataHash(plan: CrawledPlanData): string {
    const hashSource = [
      plan.sourceSite,
      plan.planName,
      plan.mvno,
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
   * 복합 데이터 표현 파싱
   * 예: "월 11GB + 매일 2GB + 3Mbps" -> { baseGB: 71, dailyGB: 2, speedMbps: 3 }
   * 매일 2GB는 30일 기준 60GB로 환산하여 기본 데이터에 추가
   */
  private parseComplexDataExpression(text: string): {
    totalGB: number;
    dailyGB: number | null;
    speedMbps: number | null;
  } {
    if (!text) return { totalGB: 0, dailyGB: null, speedMbps: null };
    if (text.includes('무제한')) return { totalGB: 999, dailyGB: null, speedMbps: null };

    let totalGB = 0;
    let dailyGB: number | null = null;
    let speedMbps: number | null = null;

    // "월 XGB" 또는 단독 "XGB" 추출
    const monthlyMatch = text.match(/(?:월\s*)?(\d+(?:\.\d+)?)\s*GB/i);
    if (monthlyMatch) {
      totalGB += parseFloat(monthlyMatch[1]);
    }

    // "매일 XGB" 추출 (30일 기준 환산)
    const dailyMatch = text.match(/매일\s*(\d+(?:\.\d+)?)\s*GB/i);
    if (dailyMatch) {
      dailyGB = parseFloat(dailyMatch[1]);
      totalGB += dailyGB * 30; // 30일 기준 총 데이터량에 합산
    }

    // "XMbps" 속도 제한 추출
    const speedMatch = text.match(/(\d+(?:\.\d+)?)\s*Mbps/i);
    if (speedMatch) {
      speedMbps = parseFloat(speedMatch[1]);
    }

    // MB 단위 처리
    const mbMatch = text.match(/(\d+(?:\.\d+)?)\s*MB/i);
    if (mbMatch && totalGB === 0) {
      totalGB = parseFloat(mbMatch[1]) / 1024;
    }

    return { totalGB, dailyGB, speedMbps };
  }

  /**
   * 데이터량 텍스트를 GB 숫자로 변환 (하위 호환성 유지)
   * 예: "5GB" -> 5, "무제한" -> 999, "500MB" -> 0.5
   */
  private parseDataAmount(text: string): number {
    const parsed = this.parseComplexDataExpression(text);
    return parsed.totalGB;
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
   * 사은품 정보 파싱 및 포맷팅
   * 예: ["네이버페이 10,000P 제공", "데이터 결합 (추가데이터 20GB)"]
   *     -> "네이버페이 10,000P | 추가 데이터 20GB"
   */
  private parseBenefits(benefitTexts: string[]): string | null {
    if (!benefitTexts || benefitTexts.length === 0) return null;

    const cleanedBenefits = benefitTexts
      .map((text) => {
        // 불필요한 접두사/접미사 제거
        return text
          .replace(/제공$/, '')
          .replace(/^\s*-\s*/, '')
          .replace(/데이터 결합\s*\(/g, '')
          .replace(/추가데이터/g, '추가 데이터')
          .replace(/\)$/g, '')
          .trim();
      })
      .filter((text) => text.length > 0);

    return cleanedBenefits.length > 0 ? cleanedBenefits.join(' | ') : null;
  }

  /**
   * moyoplan.com에서 알뜰폰 요금제 크롤링
   * 혜택 상세 정보 버튼을 모두 펼친 후 데이터 추출
   */
  async crawlPlans(): Promise<CrawledPlanData[]> {
    const targetUrl =
      this.configService.get<string>('CRAWLER_TARGET_URL') || 'https://www.moyoplan.com';

    this.logger.log(`크롤링 시작: ${targetUrl}`);
    const context = await this.playwrightService.createContext();

    // 데이터 피커 모달 방지 쿠키 설정
    await context.addCookies([
      {
        name: '_moyo_plans_filter_data_picker_saw',
        value: 'true',
        domain: 'www.moyoplan.com',
        path: '/',
        httpOnly: false,
        secure: false,
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // +1일
      },
    ]);

    const page = await context.newPage();

    try {
      // 대상 URL로 이동
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('a[href="/plans"]').first().click();
      this.logger.log('페이지 로드 완료, 요금제 카드 대기 중...');

      // 데이터 피커 모달 닫기 함수
      const closeDataPickerModal = async () => {
        const modal = page.locator('div[data-sentry-component="PlansDataPickerModal"]');
        if (await modal.isVisible()) {
          this.logger.log('데이터 피커 모달 발견, 닫기 시도...');
          await page.mouse.click(10, 10);
          await page.waitForTimeout(300);
        }
      };

      await closeDataPickerModal();

      // 요금제 카드 로드 대기
      await page.waitForSelector('div[class*="basic-plan-card"]', { timeout: 30000 });
      this.logger.log('요금제 카드 로드 완료.');

      // ============================================================
      // 1️⃣ 모든 혜택/상세 정보 버튼 펼치기
      // ============================================================
      const expandAllAccordions = async () => {
        let closedButtons = page.locator(
          'button[data-orientation="vertical"][data-state="closed"]',
        );
        let count = await closedButtons.count();
        let tries = 0;

        while (count > 0 && tries < 8) {
          this.logger.log(`닫힌 버튼 ${count}개 발견, 펼치는 중...`);
          for (let i = 0; i < count; i++) {
            try {
              await closedButtons.nth(i).click({ force: true, timeout: 1000 });
            } catch {
              // 버튼 클릭 실패 무시
            }
          }
          await page.waitForTimeout(400);
          closedButtons = page.locator('button[data-orientation="vertical"][data-state="closed"]');
          count = await closedButtons.count();
          tries++;
        }
      };

      await expandAllAccordions();
      this.logger.log('모든 상세 정보 버튼 펼치기 완료.');

      // DOM 업데이트 대기
      await page.waitForTimeout(1000);
      this.logger.log('DOM 업데이트 대기 완료, 크롤링 시작...');

      // ============================================================
      // 2️⃣ 모든 페이지 순회
      // ============================================================
      const allPlans: {
        planName: string;
        detailUrl: string | null;
        mvno: string;
        dataSummary: string;
        promoPriceText: string;
        originalPriceText: string;
        talkText: string;
        smsText: string;
        networkText: string;
        technologyText: string;
        benefits: string[];
      }[] = [];
      let currentPage = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        this.logger.log(`========== 페이지 ${currentPage} 크롤링 시작 ==========`);

        // 요금제 카드만 선택 (숫자 ID가 포함된 /plans/ 링크만)
        const cards = page.locator('a[href^="/plans/"]:has(img[alt])');
        const count = await cards.count();
        this.logger.log(`페이지 ${currentPage}에서 ${count}개 카드 발견`);

        for (let i = 0; i < count; i++) {
          try {
            this.logger.debug(`카드 ${i + 1}/${count} 처리 중...`);
            const card = cards.nth(i);

            // 요금제 상세 페이지 URL 추출
            this.logger.debug(`  - URL 추출 중...`);
            const planUrl = (await card.getAttribute('href')) || '';
            const detailUrl = planUrl ? `https://www.moyoplan.com${planUrl}` : null;
            this.logger.debug(`    URL: ${detailUrl}`);

            // MVNO 이름 (img의 alt 속성)
            this.logger.debug(`  - MVNO 추출 중...`);
            const mvno = await card
              .locator('img[alt]')
              .first()
              .getAttribute('alt', { timeout: 3000 })
              .catch(() => null);
            this.logger.debug(`    MVNO: ${mvno}`);

            // 요금제 이름과 데이터 요약 추출
            this.logger.debug(`  - 요금제 이름 & 데이터 요약 추출 중...`);
            const allSpans = await card.locator('span').allTextContents();
            this.logger.debug(`    전체 span 개수: ${allSpans.length}`);

            // GB/Mbps 포함 텍스트들 (데이터 요약 후보)
            const dataTexts = allSpans.filter(
              (text) =>
                (text.includes('GB') || text.includes('Mbps')) &&
                text.length > 2 && // 최소 길이 완화 (5 → 2)
                !text.includes('원'), // 가격 제외
            );

            // 데이터 요약: "월" 포함하거나 "+" 포함 (예: "월 100GB + 5Mbps")
            const dataSummary =
              dataTexts.find(
                (text) => text.includes('월') || (text.includes('+') && text.includes('Mbps')),
              ) ||
              dataTexts[0] ||
              '';

            // 요금제 이름: 데이터 요약이 아닌 것 중에서
            // 1. 대괄호 포함 (예: [모요핫딜])
            // 2. 괄호 포함 (예: 5G 스마트플러스(200분 + 5GB))
            // 3. 8자 이상이고 제외 키워드 없는 것
            const planName =
              allSpans.find((text) => {
                const trimmed = text.trim();
                if (trimmed === dataSummary) return false; // 데이터 요약 제외
                if (trimmed.length < 5) return false;

                // 제외 패턴
                if (trimmed.includes('원')) return false; // 가격
                if (trimmed.includes('선택')) return false; // "XXX명이 선택"
                if (trimmed.match(/^\d+\.\d+$/)) return false; // 별점 (예: "4.3")
                if (trimmed.match(/^(통화|문자)\s*(무제한|\d+분|\d+건)$/)) return false; // "통화 200분", "문자 100건"
                if (trimmed.match(/^(KT|SKT|LG U\+)망$/)) return false; // "SKT망"
                if (trimmed.match(/^(LTE|5G)$/)) return false; // "LTE", "5G"
                if (trimmed.match(/^월\s*\d+GB$/i)) return false; // "월 5GB" (데이터 요약)

                // 포함 패턴 (우선순위 순)
                if (trimmed.includes('[')) return true; // 대괄호 우선 (예: [모요핫딜])
                if (trimmed.includes('(') && trimmed.includes(')')) return true; // 괄호 포함 (예: 스마트플러스(200분 + 5GB))
                if (trimmed.length >= 8) return true; // 8자 이상

                return false;
              }) || null;

            this.logger.debug(`    planName: ${planName}`);
            this.logger.debug(`    dataSummary: ${dataSummary}`);

            // 프로모션 가격 ("월" 포함하고 "이후" 미포함)
            this.logger.debug(`  - 프로모션 가격 추출 중...`);
            const promoPrice =
              allSpans.find(
                (text) => text.includes('월') && text.includes('원') && !text.includes('이후'),
              ) || '';

            // 원래 가격 ("개월 이후" 포함)
            this.logger.debug(`  - 원래 가격 추출 중...`);
            const originalPrice =
              allSpans.find((text) => text.includes('개월') && text.includes('이후')) || '';

            // 통화/문자/망/기술 스펙
            this.logger.debug(`  - 스펙 정보 추출 중...`);
            const specs = allSpans.filter(
              (text) =>
                text.includes('통화') ||
                text.includes('문자') ||
                text.includes('망') ||
                /LTE|5G/.test(text),
            );

            const talkText = specs.find((t) => t.includes('통화')) || '';
            const smsText = specs.find((t) => t.includes('문자')) || '';
            const networkText = specs.find((t) => /(KT|SKT|LG U\+|LGU)/.test(t)) || ''; // "LG U+" 추가
            const technologyText = specs.find((t) => /(LTE|5G)/.test(t)) || '';

            // 사은품 정보 추출 (Accordion 내부 - data-state="open"인 div 안의 p 태그)
            this.logger.debug(`  - 사은품 정보 추출 중...`);
            const benefitItems = await card
              .locator('div[data-state="open"] p')
              .allTextContents()
              .catch(() => []);

            if (mvno && planName) {
              allPlans.push({
                planName: planName.trim(),
                detailUrl,
                mvno,
                dataSummary: dataSummary?.trim(),
                promoPriceText: promoPrice?.trim(),
                originalPriceText: originalPrice?.trim(),
                talkText,
                smsText,
                networkText,
                technologyText,
                benefits: benefitItems,
              });
              this.logger.debug(`✓ 카드 ${i + 1} 완료: ${planName?.trim()}`);
            } else {
              this.logger.warn(`✗ 카드 ${i + 1} 스킵: mvno=${mvno}, planName=${planName}`);
            }
          } catch (error) {
            this.logger.error(`카드 ${i + 1} 처리 중 에러:`, error);
            // 개별 카드 에러는 무시하고 계속 진행
          }
        }

        this.logger.log(`페이지 ${currentPage} 완료: 총 ${allPlans.length}개 누적`);

        // 다음 페이지로 이동
        const nextPageLink = page.locator(`a[href="/plans?page=${currentPage + 1}"]`);
        const hasNextPage = await nextPageLink.isVisible();

        if (hasNextPage) {
          this.logger.log(`다음 페이지(${currentPage + 1})로 이동 중...`);
          await nextPageLink.first().click();
          await page.waitForLoadState('networkidle');
          this.logger.log(`페이지 ${currentPage + 1} 로드 완료`);

          await closeDataPickerModal();
          await expandAllAccordions();
          await page.waitForTimeout(1000); // DOM 업데이트 대기

          currentPage++;
        } else {
          hasMorePages = false;
          this.logger.log(
            `========== 모든 페이지 크롤링 완료 (총 ${currentPage}페이지) ==========`,
          );
        }
      }

      // ============================================================
      // 3️⃣ 데이터 후처리 및 CrawledPlanData 변환
      // ============================================================
      this.logger.log(`데이터 변환 시작: ${allPlans.length}개 요금제`);
      const crawledPlans: CrawledPlanData[] = allPlans.map((plan) => {
        const mvno = plan.mvno;
        const planName = plan.planName;
        const sourceSite = 'moyoplan'; // 현재 크롤링 출처
        const detailUrl = plan.detailUrl;

        // 망 정보 정규화 ("KT망" → "KT", "LG U+망" → "LG U+")
        let network = (plan.networkText || 'Unknown').replace(/망$/, '').trim();
        // "LGU" → "LG U+" 정규화
        if (network === 'LGU') {
          network = 'LG U+';
        }

        const technology = plan.technologyText || 'LTE';
        const pricePromo = this.extractNumber(plan.promoPriceText);
        const priceOriginal = plan.originalPriceText
          ? this.extractNumber(plan.originalPriceText)
          : null;
        const promotionDurationMonths = this.parsePromotionDuration(plan.originalPriceText || '');
        const promotionEndDate = null;

        // 복합 데이터 표현 파싱 (월 11GB + 매일 2GB + 3Mbps)
        const dataInfo = this.parseComplexDataExpression(plan.dataSummary);
        const dataBaseGB = dataInfo.totalGB;
        const dataPostSpeedMbps = dataInfo.speedMbps;

        const talkMinutes = this.parseUnlimitedOrNumber(plan.talkText);
        const smsCount = this.parseUnlimitedOrNumber(plan.smsText);
        const benefitSummary = this.parseBenefits(plan.benefits);

        return {
          planName,
          sourceSite,
          detailUrl,
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

      this.logger.log(`총 ${crawledPlans.length}개 요금제 크롤링 완료`);
      return crawledPlans;
    } catch (error) {
      this.logger.error('크롤링 실패:', error);
      throw error;
    } finally {
      await page.close();
      await context.close();
      await this.playwrightService.closeBrowser();
    }
  }

  /**
   * U+ 알뜰폰 공식몰 크롤링
   * - 출처: https://www.uplusmvno.com/plan/plan-list
   * - SPA 기반 사이트, Playwright로 DOM 접근
   * - 페이지네이션 지원 (다음 버튼 클릭)
   */
  async crawlPlansUplus(): Promise<CrawledPlanData[]> {
    const targetUrl = 'https://www.uplusmvno.com/plan/plan-list';
    this.logger.log(`U+ 알뜰폰 크롤링 시작: ${targetUrl}`);

    const context = await this.playwrightService.createContext();
    const page = await context.newPage();

    try {
      // 페이지 이동
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // .plan_item 렌더링 대기
      await page.waitForSelector('.plan_item', { timeout: 30000 });
      this.logger.log('.plan_item 로드 완료');

      const crawledPlans: CrawledPlanData[] = [];
      let currentPage = 1;
      let hasNextPage = true;

      // ============================================================
      // 모든 페이지 순회
      // ============================================================
      while (hasNextPage) {
        this.logger.log(`========== 페이지 ${currentPage} 크롤링 시작 ==========`);

        // 현재 페이지의 모든 요금제 카드 수집
        const planItems = page.locator('.plan_item');
        const count = await planItems.count();
        this.logger.log(`페이지 ${currentPage}에서 ${count}개 요금제 발견`);

        for (let i = 0; i < count; i++) {
          try {
            const item = planItems.nth(i);

            // 1. 요금제명
            const planName =
              (await item.locator('.plan_tit').first().textContent({ timeout: 3000 })) || 'Unknown';

            // 2. 데이터 요약 (예: "월 100GB + 5Mbps")
            const dataSummary =
              (await item
                .locator('.plan_tit_sub')
                .first()
                .textContent({ timeout: 3000 })
                .catch(() => null)) || '';

            // 3. 제휴사 (data-gtm-click-text에서 추출)
            // 예: "에스원안심모바일|[유심/eSIM무료+Npay 3만P] 100GB+/통화마음껏_24개월|월 100GB + 5Mbps"
            const gtmClickText =
              (await item
                .locator('a.link_list')
                .first()
                .getAttribute('data-gtm-click-text', { timeout: 3000 })
                .catch(() => null)) || null;

            let mvno = 'Unknown';
            if (gtmClickText) {
              // 파이프(|)로 분리하여 첫 번째 부분이 MVNO
              const parts = gtmClickText.split('|');
              if (parts.length > 0) {
                mvno = parts[0].trim() || 'Unknown';
              }
            }

            // 4. 네트워크 (LTE/5G)
            const cellularText =
              (await item
                .locator('.cellular')
                .first()
                .textContent({ timeout: 3000 })
                .catch(() => null)) || '';
            const technology = cellularText.includes('5G') ? '5G' : 'LTE';

            // 5. 통화량
            const phoneText =
              (await item
                .locator('.phone')
                .first()
                .textContent({ timeout: 3000 })
                .catch(() => null)) || '';
            const talkMinutes =
              phoneText.includes('기본제공') || phoneText.includes('무제한')
                ? 9999
                : this.extractNumber(phoneText);

            // 6. 월 요금 (텍스트 노드만 추출하여 tooltip 제외)
            const monthPriceText =
              (await item
                .locator('.card_price .month')
                .first()
                .evaluate((el: Element) => {
                  // childNodes에서 텍스트 노드만 추출 (tooltip 버튼 제외)
                  const textNodes = Array.from(el.childNodes)
                    .filter((node) => node.nodeType === Node.TEXT_NODE)
                    .map((node) => node.textContent?.trim() || '')
                    .filter((text) => text.length > 0);
                  return textNodes.join(' ');
                })
                .catch(() => '')) || '';
            const pricePromo = this.extractNumber(monthPriceText);

            // 7. 정상 요금 및 계약 기간 (예: "24개월 이후 44,000원")
            const periodText =
              (await item
                .locator('.card_price .period')
                .first()
                .textContent({ timeout: 3000 })
                .catch(() => null)) || '';
            const priceOriginal = periodText ? this.extractNumber(periodText) : null;

            // 계약 기간 파싱
            const contractMatch = periodText.match(/(\d+)\s*개월/);
            const contractPeriod = contractMatch ? parseInt(contractMatch[1], 10) : null;

            // 8. 상세 URL
            const detailUrl =
              (await item
                .locator('a.link_list')
                .first()
                .getAttribute('data-gtm-click-url', { timeout: 3000 })
                .catch(() => null)) || null;

            // 9. 혜택 정보 (사은품 버튼 클릭하여 추출)
            let benefitSummary: string | null = null;
            try {
              const benefitButton = item.locator('button.btn_acc');
              const benefitButtonExists = await benefitButton.count();

              if (benefitButtonExists > 0) {
                // aria-expanded가 false면 버튼 클릭하여 펼치기
                const isExpanded = (await benefitButton.getAttribute('aria-expanded')) === 'true';

                if (!isExpanded) {
                  await benefitButton.click({ timeout: 2000 });
                  await page.waitForTimeout(500); // 애니메이션 대기
                }

                // 혜택 이미지의 alt 텍스트 수집
                const giftImages = item.locator('.bag_list img[alt]');
                const benefitAlts = await giftImages.evaluateAll((imgs: Element[]) =>
                  imgs
                    .map((img: Element) => (img as HTMLImageElement).alt)
                    .filter((alt: string) => alt && alt.trim() && !alt.includes('이미지')),
                );

                if (benefitAlts.length > 0) {
                  benefitSummary = benefitAlts.join(' | ');
                }
              }
            } catch (benefitError) {
              this.logger.debug(`혜택 정보 추출 실패 (카드 ${i + 1}):`, benefitError);
              // 혜택 정보 실패는 무시하고 계속 진행
            }

            // 데이터량 파싱 (예: "월 100GB + 5Mbps" -> 100)
            const dataBaseGB = this.parseDataAmount(dataSummary);

            // 속도 제한 파싱 (예: "월 100GB + 5Mbps" -> 5)
            const dataPostSpeedMbps = this.parseSpeed(dataSummary);

            // CrawledPlanData 생성
            const crawledPlan: CrawledPlanData = {
              planName: planName.trim(),
              sourceSite: 'uplus',
              detailUrl,
              mvno,
              network: 'LG U+', // U+ 알뜰폰은 모두 LG U+ 망 사용
              technology,
              pricePromo,
              priceOriginal,
              promotionDurationMonths: contractPeriod,
              promotionEndDate: null,
              dataBaseGB,
              dataPostSpeedMbps,
              talkMinutes,
              smsCount: 9999, // U+ 알뜰폰은 일반적으로 문자 무제한 제공
              benefitSummary,
            };

            crawledPlans.push(crawledPlan);
            this.logger.debug(`✓ ${i + 1}/${count} 완료: ${planName.trim()}`);
          } catch (error) {
            this.logger.error(`카드 ${i + 1} 처리 중 에러:`, error);
            // 개별 카드 에러는 무시하고 계속 진행
          }
        }

        this.logger.log(`페이지 ${currentPage} 완료: 총 ${crawledPlans.length}개 누적`);

        // 다음 페이지로 이동
        const nextButton = page.locator('button:has-text("다음")').first();
        const nextButtonExists = await nextButton.count();

        if (nextButtonExists > 0 && (await nextButton.isVisible())) {
          this.logger.log(`다음 페이지(${currentPage + 1})로 이동 중...`);
          await nextButton.click();
          await page.waitForTimeout(2000); // 페이지 로딩 대기
          await page.waitForSelector('.plan_item', { timeout: 10000 });
          currentPage++;
        } else {
          hasNextPage = false;
          this.logger.log(
            `========== 모든 페이지 크롤링 완료 (총 ${currentPage}페이지) ==========`,
          );
        }
      }

      this.logger.log(`U+ 알뜰폰 크롤링 완료: ${crawledPlans.length}개 요금제`);
      return crawledPlans;
    } catch (error) {
      this.logger.error('U+ 알뜰폰 크롤링 실패:', error);
      throw error;
    } finally {
      await page.close();
      await context.close();
      await this.playwrightService.closeBrowser();
    }
  }

  /**
   * 더미 크롤링 로직 (테스트용)
   */
  crawlPlansDemo(): CrawledPlanData[] {
    this.logger.log('더미 크롤링 시작 (테스트 데이터 생성)');

    const dummyPlans: CrawledPlanData[] = [
      {
        planName: '[모요핫딜]음성기본 11GB+일 2GB+',
        sourceSite: 'moyoplan',
        detailUrl: 'https://www.moyoplan.com/plans/29214',
        mvno: '찬스모바일',
        network: 'LG U+',
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
        planName: '알뜰 5G 무제한',
        sourceSite: 'moyoplan',
        detailUrl: 'https://www.moyoplan.com/plans/12345',
        mvno: '유모바일',
        network: 'SKT',
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
        planName: '프리티 프리미엄',
        sourceSite: 'moyoplan',
        detailUrl: 'https://www.moyoplan.com/plans/67890',
        mvno: '프리티',
        network: 'KT',
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
   * @param sources 크롤링할 소스 배열 (기본값: ['moyo', 'uplus'])
   * @returns Upsert된 요금제 데이터 배열
   */
  async crawlAndSavePlans(
    useDemo = true,
    sources: ('moyo' | 'uplus')[] = ['moyo', 'uplus'],
  ): Promise<RawPlan[]> {
    try {
      this.logger.log('크롤러 워크플로우 시작...');

      let crawledPlans: CrawledPlanData[] = [];

      if (useDemo) {
        // 1-A. 더미 데이터 생성
        crawledPlans = this.crawlPlansDemo();
      } else {
        // 1-B. 실제 크롤링 (병렬 실행)
        const crawlTasks: Promise<CrawledPlanData[]>[] = [];

        if (sources.includes('moyo')) {
          crawlTasks.push(
            this.crawlPlans().catch((error) => {
              this.logger.error('Moyo 크롤링 실패:', error);
              return []; // 실패 시 빈 배열 반환
            }),
          );
        }

        if (sources.includes('uplus')) {
          crawlTasks.push(
            this.crawlPlansUplus().catch((error) => {
              this.logger.error('U+ 크롤링 실패:', error);
              return []; // 실패 시 빈 배열 반환
            }),
          );
        }

        // Promise.allSettled로 병렬 실행 (일부 실패해도 계속 진행)
        const results = await Promise.allSettled(crawlTasks);

        crawledPlans = results
          .filter((result) => result.status === 'fulfilled')
          .flatMap((result) => result.value);

        this.logger.log(
          `크롤링 완료: Moyo ${sources.includes('moyo') ? '✓' : '✗'}, U+ ${sources.includes('uplus') ? '✓' : '✗'}`,
        );
      }

      this.logger.log(`${crawledPlans.length}개 요금제 데이터 추출 완료`);

      // 2. Upsert: dataHash 기준으로 데이터 삽입/업데이트
      const upsertedPlans: RawPlan[] = [];

      for (const plan of crawledPlans) {
        try {
          // dataHash 생성 (sourceSite + planName + 핵심 스펙 조합)
          const dataHash = this.generateDataHash(plan);

          const upsertedPlan = await this.prisma.rawPlan.upsert({
            where: {
              dataHash, // dataHash를 Upsert 기준으로 사용
            },
            update: {
              planName: plan.planName,
              sourceSite: plan.sourceSite,
              detailUrl: plan.detailUrl,
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
              planName: plan.planName,
              dataHash,
              sourceSite: plan.sourceSite,
              detailUrl: plan.detailUrl,
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
          this.logger.debug(`Upsert 완료: ${upsertedPlan.planName} (${upsertedPlan.sourceSite})`);
        } catch (error) {
          this.logger.error(`Upsert 실패: ${plan.planName} (${plan.sourceSite})`, error);
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
