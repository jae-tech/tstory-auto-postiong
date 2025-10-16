import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '@/prisma/prisma.service';
import { RawPlan } from '@prisma/client';

/**
 * Markdown 블로그 포스트 인터페이스
 */
interface MarkdownPost {
  content: string; // Markdown 형식의 전체 콘텐츠
  title: string; // 추출된 제목
  tags: string[]; // SEO 태그
}

/**
 * 분석기 서비스: Gemini API를 사용한 요금제 분석 및 비교형 블로그 콘텐츠 생성
 */
@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);
  private genAI: GoogleGenerativeAI;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * 데이터베이스에서 모든 요금제 조회
   */
  async getAllPlans(): Promise<RawPlan[]> {
    return await this.prisma.rawPlan.findMany({
      orderBy: {
        pricePromo: 'asc',
      },
    });
  }

  /**
   * 1️⃣ 평생 요금제 TOP 10 필터링
   */
  private filterLifetimePlans(plans: RawPlan[]): RawPlan[] {
    return plans
      .filter((plan) => plan.promotionDurationMonths === 999)
      .sort((a, b) => a.pricePromo - b.pricePromo)
      .slice(0, 10);
  }

  /**
   * 2️⃣ 기간 한정 요금제 TOP 10 필터링
   */
  private filterLimitedTimePlans(plans: RawPlan[]): RawPlan[] {
    return plans
      .filter(
        (plan) =>
          plan.promotionDurationMonths !== null &&
          plan.promotionDurationMonths >= 1 &&
          plan.promotionDurationMonths <= 6,
      )
      .sort((a, b) => a.pricePromo - b.pricePromo)
      .slice(0, 10);
  }

  /**
   * 3️⃣ 데이터 무제한 요금제 TOP 10 필터링
   */
  private filterUnlimitedDataPlans(plans: RawPlan[]): RawPlan[] {
    return plans
      .filter(
        (plan) => plan.dataBaseGB >= 100 || (plan.dataPostSpeedMbps && plan.dataPostSpeedMbps >= 5),
      )
      .sort((a, b) => {
        // 데이터량 우선, 그 다음 속도, 마지막 가격
        if (b.dataBaseGB !== a.dataBaseGB) return b.dataBaseGB - a.dataBaseGB;
        const speedB = b.dataPostSpeedMbps || 0;
        const speedA = a.dataPostSpeedMbps || 0;
        if (speedB !== speedA) return speedB - speedA;
        return a.pricePromo - b.pricePromo;
      })
      .slice(0, 10);
  }

  /**
   * 4️⃣ 데이터 많이 주는 요금제 TOP 10 필터링
   */
  private filterHighDataPlans(plans: RawPlan[]): RawPlan[] {
    return plans.sort((a, b) => b.dataBaseGB - a.dataBaseGB).slice(0, 10);
  }

  /**
   * 5️⃣ 통화 무제한 요금제 TOP 10 필터링
   */
  private filterUnlimitedTalkPlans(plans: RawPlan[]): RawPlan[] {
    return plans
      .filter((plan) => plan.talkMinutes === 9999 || plan.talkMinutes >= 3000)
      .sort((a, b) => a.pricePromo - b.pricePromo)
      .slice(0, 10);
  }

  /**
   * 요금제 데이터를 JSON 배열로 포맷팅 (Gemini API 입력용)
   */
  private formatPlansAsJson(plans: RawPlan[]): string {
    const formatted = plans.map((plan) => ({
      planName: plan.planId,
      mvno: plan.mvno,
      network: plan.network,
      technology: plan.technology,
      dataBaseGB: plan.dataBaseGB === 999 ? '무제한' : plan.dataBaseGB,
      dataPostSpeedMbps: plan.dataPostSpeedMbps || null,
      talkMinutes: plan.talkMinutes === 9999 ? '무제한' : plan.talkMinutes,
      smsCount: plan.smsCount === 9999 ? '무제한' : plan.smsCount,
      pricePromo: plan.pricePromo,
      priceOriginal: plan.priceOriginal,
      promotionDurationMonths:
        plan.promotionDurationMonths === 999 ? '평생' : plan.promotionDurationMonths,
      benefitSummary: plan.benefitSummary || '없음',
    }));

    return JSON.stringify(formatted, null, 2);
  }

  /**
   * SEO 최적화된 블로그 포스트 생성을 위한 Gemini API 프롬프트 생성
   */
  private buildPostPrompt(plans: RawPlan[]): string {
    // 현재 날짜 (YYYY-MM-DD 형식)
    const today = new Date().toISOString().split('T')[0];

    // 5가지 테마별로 요금제 필터링
    const lifetimePlans = this.filterLifetimePlans(plans);
    const limitedTimePlans = this.filterLimitedTimePlans(plans);
    const unlimitedDataPlans = this.filterUnlimitedDataPlans(plans);
    const highDataPlans = this.filterHighDataPlans(plans);
    const unlimitedTalkPlans = this.filterUnlimitedTalkPlans(plans);

    const prompt = `
[역할 지정]: 당신은 알뜰폰 시장을 완벽하게 분석하는 통신비 절약 전문가입니다.

[목표 및 주제]: **'2025년 알뜰폰 요금제 추천: 무제한 데이터/가성비 TOP 5 완벽 정리 (매일 업데이트 반영)'** 제목의 블로그 포스팅 초안을 작성하십시오.

[대상 독자]: 비싼 통신 요금 때문에 알뜰폰으로 갈아타기를 고려하는 모든 사용자.

[포스팅 형식]:
- 분량: 최소 2,500자 이상.
- 구성:
  1. 후킹 제목 (클릭을 유도하는 매력적인 제목)
  2. 도입 (최신 정보 제공 강조)
  3. 본론 1: 선택 기준 3가지 분석 (가격, 데이터, 프로모션 기간)
  4. 본론 2: 카테고리별 추천 TOP 5 상세 분석
  5. 요금제 비교표 (핵심) - Markdown Table 형식
  6. 업데이트 정보
  7. 결론 (셀프 개통 및 CTA)
- 필수 요소: 각 요금제는 표(Markdown Table)로 정리하고, '통신사명', '월 요금', '데이터/속도', '프로모션 기간'을 명확히 명시.

[톤앤매너]: 전문적이고 신뢰감을 주지만, 친절하고 설득력이 강한 말투.

[요청 세부 사항]:
1. 핵심 키워드 '알뜰폰 요금제', '알뜰폰 추천', '무제한 데이터', '셀프 개통'을 본문 전체에 최소 8회 이상 자연스럽게 분산하여 SEO를 극대화하십시오.
2. 모든 내용은 Markdown 형식으로 작성해야 합니다.
3. 요금제 정보는 독자가 가장 궁금해할 만한 최신 데이터를 아래 제공된 실제 데이터 기반으로 작성합니다.
4. 글의 가장 아래에 "**최종 데이터 확인일: ${today}**" 문구를 굵게 표시하십시오.

# 실제 요금제 데이터

## 1️⃣ 평생 요금제 TOP 5 (할인 기간 평생 유지)
${this.formatPlansAsJson(lifetimePlans.slice(0, 5))}

## 2️⃣ 기간 한정 요금제 TOP 5 (1~6개월 프로모션)
${this.formatPlansAsJson(limitedTimePlans.slice(0, 5))}

## 3️⃣ 데이터 무제한 요금제 TOP 5 (100GB 이상 또는 고속 무제한)
${this.formatPlansAsJson(unlimitedDataPlans.slice(0, 5))}

## 4️⃣ 데이터 많이 주는 요금제 TOP 5 (대용량 데이터 제공)
${this.formatPlansAsJson(highDataPlans.slice(0, 5))}

## 5️⃣ 통화 무제한 요금제 TOP 5 (통화 무제한 또는 3000분 이상)
${this.formatPlansAsJson(unlimitedTalkPlans.slice(0, 5))}

# 작성 가이드라인

## 1. 본문 구조 (Markdown 형식)

\`\`\`markdown
# 2025년 알뜰폰 요금제 추천: 무제한 데이터/가성비 TOP 5 완벽 정리

## 📌 들어가며
(최신 정보 제공 강조, 알뜰폰 요금제 선택의 중요성)

## 🎯 알뜰폰 요금제 선택 기준 3가지
1. **가격 대비 데이터 제공량**
2. **프로모션 기간과 할인율**
3. **통신망 품질 (SKT, KT, LG U+)**

## 🏆 카테고리별 추천 TOP 5

### 1️⃣ 평생 요금제 TOP 5
(설명 및 Markdown Table)

| 순위 | 요금제명 | 사업자 | 통신망 | 데이터 | 통화 | 월 요금 |
|------|----------|--------|--------|--------|------|---------|
| 1    | ...      | ...    | ...    | ...    | ...  | ...     |

### 2️⃣ 기간 한정 요금제 TOP 5
(설명 및 Markdown Table)

### 3️⃣ 데이터 무제한 요금제 TOP 5
(설명 및 Markdown Table)

### 4️⃣ 데이터 많이 주는 요금제 TOP 5
(설명 및 Markdown Table)

### 5️⃣ 통화 무제한 요금제 TOP 5
(설명 및 Markdown Table)

## 💡 셀프 개통 팁
(알뜰폰 셀프 개통 방법 및 주의사항)

## 📝 마무리
(요금제 비교의 중요성, CTA)

**최종 데이터 확인일: ${today}**
\`\`\`

## 2. Markdown Table 작성 규칙

- 모든 요금제는 Markdown Table 형식으로 작성
- 단위 표기:
  * 데이터: "GB" (예: "11GB", "무제한")
  * 속도: "Mbps" (예: "5Mbps")
  * 가격: "원" (예: "9,900원")
- benefitSummary는 별도 컬럼 또는 각주로 표시

## 3. SEO 최적화 요구사항

- '알뜰폰 요금제' 키워드: 최소 3회 이상
- '알뜰폰 추천' 키워드: 최소 2회 이상
- '무제한 데이터' 키워드: 최소 2회 이상
- '셀프 개통' 키워드: 최소 1회 이상
- 제목에 숫자(TOP 5)와 연도(2025) 포함
- 메타 설명에 핵심 키워드 포함

## 4. 주의사항

- 위에 제공된 실제 요금제 데이터를 정확히 사용할 것
- 데이터량 999는 "무제한"으로 표시
- 통화 9999분은 "무제한"으로 표시
- 가격은 천 단위 쉼표 포함
- 모든 정보는 ${today} 기준임을 명시
- 최소 2,500자 이상 작성
- Markdown 형식 준수

응답은 순수 Markdown 텍스트로만 작성하고, JSON이나 다른 형식은 사용하지 마십시오.`;

    return prompt;
  }

  /**
   * Markdown 포스트를 post_queue에 저장
   */
  private async saveMarkdownToQueue(markdownPost: MarkdownPost): Promise<void> {
    try {
      // 포스트 큐에 추가 (Markdown 내용을 htmlBody로 저장)
      await this.prisma.postQueue.create({
        data: {
          title: markdownPost.title,
          htmlBody: markdownPost.content,
          tags: markdownPost.tags,
          status: 'PENDING',
        },
      });

      this.logger.log(`Markdown 포스트 큐에 저장 완료: ${markdownPost.title}`);
    } catch (error) {
      this.logger.error(`Markdown 포스트 큐 저장 실패:`, error);
      throw error;
    }
  }

  /**
   * 여러 요금제를 한 번에 분석 (SEO 최적화된 Markdown 블로그 생성)
   */
  private async analyzeBulkWithGemini(plans: RawPlan[]): Promise<MarkdownPost> {
    this.logger.log(`${plans.length}개 요금제 일괄 분석 중 (SEO 최적화 블로그)...`);

    try {
      const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash-lite';
      const model = this.genAI.getGenerativeModel({ model: modelName });

      const prompt = this.buildPostPrompt(plans);

      this.logger.debug('Gemini API 호출 중 (SEO 최적화 블로그 생성)...');
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      this.logger.debug(`Gemini 응답: ${text.substring(0, 200)}...`);

      // Markdown 코드블록 제거 (있을 경우)
      let markdownContent = text.trim();
      markdownContent = markdownContent.replace(/^```markdown\s*/i, '').replace(/\s*```$/, '');
      markdownContent = markdownContent.replace(/^```\s*/, '').replace(/\s*```$/, '');

      // 응답 검증
      if (markdownContent.length < 2500) {
        this.logger.warn(`콘텐츠가 너무 짧습니다 (${markdownContent.length}자, 최소 2500자)`);
      }

      // 제목 추출 (첫 번째 # 헤딩)
      const titleMatch = markdownContent.match(/^#\s+(.+)$/m);
      const title = titleMatch
        ? titleMatch[1].trim()
        : '2025년 알뜰폰 요금제 추천: 무제한 데이터/가성비 TOP 5';

      // SEO 태그 생성
      const tags = [
        '알뜰폰 요금제',
        '알뜰폰 추천',
        '무제한 데이터',
        '셀프 개통',
        '가성비 요금제',
        '2025년 알뜰폰',
        '통신비 절약',
        '데이터 무제한',
      ];

      // 키워드 출현 횟수 검증
      const keywordChecks = {
        '알뜰폰 요금제': (markdownContent.match(/알뜰폰 요금제/g) || []).length,
        알뜰폰추천: (markdownContent.match(/알뜰폰 추천/g) || []).length,
        무제한데이터: (markdownContent.match(/무제한 데이터/g) || []).length,
        셀프개통: (markdownContent.match(/셀프 개통/g) || []).length,
      };

      this.logger.log(`키워드 출현 횟수: ${JSON.stringify(keywordChecks)}`);

      if (keywordChecks['알뜰폰 요금제'] < 3) {
        this.logger.warn(`'알뜰폰 요금제' 키워드 부족 (${keywordChecks['알뜰폰 요금제']}회)`);
      }

      this.logger.log(`일괄 분석 완료 (제목: ${title})`);

      return {
        content: markdownContent,
        title: title,
        tags: tags,
      };
    } catch (error) {
      this.logger.error(`일괄 분석 실패:`, error);
      throw error;
    }
  }

  /**
   * 분석기 워크플로우 메인 메서드
   */
  async runAnalyzer(): Promise<{
    totalPlans: number;
    processed: number;
    failed: number;
    success: boolean;
  }> {
    try {
      this.logger.log('분석기 워크플로우 시작...');

      // 모든 요금제 조회
      const plans = await this.getAllPlans();
      this.logger.log(`전체 요금제 ${plans.length}개 조회`);

      if (plans.length === 0) {
        this.logger.warn('분석할 요금제가 없습니다');
        return {
          totalPlans: 0,
          processed: 0,
          failed: 0,
          success: true,
        };
      }

      // SEO 최적화 Markdown 블로그 생성
      const markdownPost = await this.analyzeBulkWithGemini(plans);

      // PostQueue에 저장
      await this.saveMarkdownToQueue(markdownPost);

      this.logger.log('SEO 최적화 블로그 분석 완료: 1개 포스트 생성');

      return {
        totalPlans: plans.length,
        processed: 1,
        failed: 0,
        success: true,
      };
    } catch (error) {
      this.logger.error('분석기 워크플로우 실패:', error);
      return {
        totalPlans: 0,
        processed: 0,
        failed: 1,
        success: false,
      };
    }
  }
}
