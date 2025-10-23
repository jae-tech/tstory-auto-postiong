import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '@/prisma/prisma.service';
import { RawPlan } from '@prisma/client';

/**
 * HTML 블로그 포스트 인터페이스
 */
interface HtmlPost {
  htmlBody: string; // HTML 형식의 전체 콘텐츠
  title: string; // 추출된 제목
  tags: string[]; // SEO 태그
  description: string; // 메타 설명
}

/**
 * 사용자 유형별 요금제 분류 결과 (7가지 카테고리)
 */
interface UserTypeClassification {
  navigation: RawPlan[]; // 네비게이션용 요금제
  subLine: RawPlan[]; // 서브회선/세컨드폰용 요금제
  tablet: RawPlan[]; // 태블릿/스마트기기 전용 요금제
  kidsSenior: RawPlan[]; // 어린이/시니어 특화 요금제
  business: RawPlan[]; // 업무/비즈니스 전용 요금제
  promotion: RawPlan[]; // 프로모션 한정 요금제
  lifetime: RawPlan[]; // 평생형/상시할인 요금제
}

/**
 * 분석기 서비스: Gemini API를 사용한 요금제 분석 및 비교형 블로그 콘텐츠 생성
 */
@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);
  private genAI: GoogleGenerativeAI;
  private readonly CHUNK_SIZE = 150; // 청크당 요금제 개수 (TPM 제한 회피)
  private readonly MAX_CONCURRENT = 1; // 순차 실행 (병렬 처리 비활성화)

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
   * 배열을 지정된 크기의 청크로 분할
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }

  /**
   * 배치 분석을 위한 Gemini 프롬프트 생성 (7가지 카테고리)
   */
  private buildBatchAnalysisPrompt(chunk: RawPlan[]): string {
    const formattedPlans = chunk.map((plan) => ({
      id: plan.id,
      planName: plan.planName,
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

    return `다음은 알뜰폰 요금제 데이터입니다:

${JSON.stringify(formattedPlans, null, 2)}

아래 7가지 사용 목적별 카테고리로 분류하고, 각 카테고리별 TOP5 요금제를 JSON 형태로 반환하세요.

🧩 분류 카테고리 (총 7개)

1️⃣ **네비게이션용 요금제**
   - 차량 내비게이션, 블랙박스, 공기계 등 저용량 데이터 전용
   - 월 0~1GB, 1천~2천원대

2️⃣ **서브회선/세컨드폰용 요금제**
   - OTP·인증용, 듀얼심, 업무용 서브폰
   - 100~300분 통화, 1GB 내외, 1~3천원대

3️⃣ **태블릿/스마트기기 전용 요금제**
   - 태블릿, 러닝패드, IoT 기기 등 데이터 전용
   - 1~10GB, 3~8천원대

4️⃣ **어린이/시니어 특화 요금제**
   - 간단한 통화 중심, 음성무제한, 소량 데이터
   - 3~5천원대

5️⃣ **업무/비즈니스 전용 요금제**
   - 통화량 많고, 데이터 5~20GB, 프로모션형 중심
   - 5천~1만원대

6️⃣ **프로모션 한정 요금제**
   - 단기 이벤트성 요금제 (3~12개월 할인형)
   - promotionDurationMonths 값이 1~12 사이

7️⃣ **평생형/상시할인 요금제**
   - 프로모션 없이 상시 저가형 (promotionDurationMonths = 999)
   - 장기 사용자 중심의 실속 요금제

반환 형식 (반드시 유효한 JSON만 출력):
{
  "네비게이션용": [요금제 id 배열 (최대 5개)],
  "서브회선세컨드폰용": [요금제 id 배열 (최대 5개)],
  "태블릿스마트기기용": [요금제 id 배열 (최대 5개)],
  "어린이시니어용": [요금제 id 배열 (최대 5개)],
  "업무비즈니스용": [요금제 id 배열 (최대 5개)],
  "프로모션형": [요금제 id 배열 (최대 5개)],
  "평생형": [요금제 id 배열 (최대 5개)]
}

예시:
{
  "네비게이션용": [123, 456, 789, 234, 567],
  "서브회선세컨드폰용": [234, 567, 890, 345, 678],
  "태블릿스마트기기용": [345, 678, 901, 456, 789],
  "어린이시니어용": [456, 789, 012, 567, 890],
  "업무비즈니스용": [567, 890, 123, 678, 901],
  "프로모션형": [678, 901, 234, 789, 012],
  "평생형": [789, 012, 345, 890, 123]
}

주의사항:
- 반드시 순수 JSON 형태로만 응답하세요
- 코드 블록(\`\`\`json) 사용 금지
- 각 카테고리별 최대 5개까지만 선정
- id는 숫자 배열로 반환
- 설명이나 추가 텍스트 없이 JSON만 출력`;
  }

  /**
   * Gemini API 호출 (재시도 로직 포함)
   */
  private async callGemini(prompt: string, retries = 2): Promise<string> {
    const modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash-lite';
    const model = this.genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        this.logger.debug(`Gemini API 호출 시도 ${attempt + 1}/${retries + 1}...`);
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // JSON 코드 블록 제거
        let cleanedText = text.trim();
        cleanedText = cleanedText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');

        return cleanedText;
      } catch (error) {
        this.logger.warn(`Gemini API 호출 실패 (시도 ${attempt + 1}/${retries + 1}):`, error);

        if (attempt === retries) {
          throw error;
        }

        // 재시도 전 대기 (지수 백오프)
        const waitTime = Math.pow(2, attempt) * 1000;
        this.logger.debug(`${waitTime}ms 대기 후 재시도...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    throw new Error('Gemini API 호출 최대 재시도 횟수 초과');
  }

  /**
   * 배치 분석: 2400개 요금제를 300개씩 나눠서 병렬 분석
   */
  async analyzeInChunks(plans: RawPlan[]): Promise<any[]> {
    // 1️⃣ 배치 분할
    const batchSize = this.CHUNK_SIZE;
    const batches: RawPlan[][] = [];
    for (let i = 0; i < plans.length; i += batchSize) {
      batches.push(plans.slice(i, i + batchSize));
    }

    this.logger.log(
      `📊 총 ${plans.length}개의 요금제를 ${batchSize}개 단위로 나눔 (${batches.length}개 배치)`,
    );

    const results: any[] = [];

    // 2️⃣ 순차 실행
    const totalStart = Date.now();

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchStart = Date.now();

      this.logger.log(
        `🧠 [${i + 1}/${batches.length}]번째 배치 분석 시작 (${new Date().toLocaleTimeString()})`,
      );

      try {
        const prompt = this.buildBatchAnalysisPrompt(batch);
        const response = await this.callGemini(prompt);

        // JSON 파싱
        const parsed = JSON.parse(response);

        const elapsedSec = ((Date.now() - batchStart) / 1000).toFixed(1);
        this.logger.log(`✅ [${i + 1}]번째 배치 완료 (소요시간: ${elapsedSec}초)`);

        results.push({
          chunkIndex: i + 1,
          data: parsed,
          planIds: batch.map((p) => p.id),
        });

        // 다음 배치 전 대기
        if (i < batches.length - 1) {
          const delayMs = parseFloat(elapsedSec) < 5 ? 15_000 : 10_000;
          this.logger.log(`⏳ 다음 배치까지 ${delayMs / 1000}초 대기 중...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        this.logger.error(`❌ [${i + 1}]번째 배치 처리 중 오류 발생:`, error);
      }
    }

    const totalElapsedMin = ((Date.now() - totalStart) / 1000 / 60).toFixed(2);
    this.logger.log(
      `🏁 전체 ${batches.length}개 배치 분석 완료 (총 소요시간: ${totalElapsedMin}분)`,
    );

    return results;
  }

  /**
   * 청크 결과 통합: 유형별로 합치고 상위 10개만 남김 (7가지 카테고리)
   */
  mergeChunkResults(results: any[], allPlans: RawPlan[]): UserTypeClassification {
    this.logger.log(`청크 결과 통합 시작: ${results.length}개 청크`);

    // Plan ID -> RawPlan 매핑
    const planMap = new Map<number, RawPlan>();
    for (const plan of allPlans) {
      planMap.set(plan.id, plan);
    }

    // 유형별 요금제 수집 (한글 키로 매핑)
    const aggregated: Record<string, Set<number>> = {
      navigation: new Set(),
      subLine: new Set(),
      tablet: new Set(),
      kidsSenior: new Set(),
      business: new Set(),
      promotion: new Set(),
      lifetime: new Set(),
    };

    // 한글 키 → 영문 키 매핑
    const koreanToEnglishKey: Record<string, keyof UserTypeClassification> = {
      네비게이션용: 'navigation',
      서브회선세컨드폰용: 'subLine',
      태블릿스마트기기용: 'tablet',
      어린이시니어용: 'kidsSenior',
      업무비즈니스용: 'business',
      프로모션형: 'promotion',
      평생형: 'lifetime',
    };

    // 영문 키 → 한글 키 매핑 (로깅용)
    const englishToKoreanKey: Record<string, string> = {
      navigation: '네비게이션용',
      subLine: '서브회선/세컨드폰용',
      tablet: '태블릿/스마트기기용',
      kidsSenior: '어린이/시니어용',
      business: '업무/비즈니스용',
      promotion: '프로모션 한정',
      lifetime: '평생형/상시할인',
    };

    // 모든 청크 결과를 통합
    for (const result of results) {
      const { data } = result;

      for (const [koreanKey, planIds] of Object.entries(data)) {
        const englishKey = koreanToEnglishKey[koreanKey];
        if (englishKey && aggregated[englishKey] && Array.isArray(planIds)) {
          for (const id of planIds) {
            aggregated[englishKey].add(id);
          }
        }
      }
    }

    // 각 유형별로 pricePromo 기준 상위 10개만 선정
    const final: UserTypeClassification = {
      navigation: [],
      subLine: [],
      tablet: [],
      kidsSenior: [],
      business: [],
      promotion: [],
      lifetime: [],
    };

    for (const [englishKey, planIdSet] of Object.entries(aggregated)) {
      const plans = Array.from(planIdSet)
        .map((id) => planMap.get(id))
        .filter((plan): plan is RawPlan => plan !== undefined)
        .sort((a, b) => a.pricePromo - b.pricePromo)
        .slice(0, 10);

      final[englishKey as keyof UserTypeClassification] = plans;

      const koreanLabel = englishToKoreanKey[englishKey] || englishKey;
      this.logger.log(`${koreanLabel}: ${plans.length}개 요금제 선정`);
    }

    return final;
  }

  /**
   * 배치 분석 워크플로우 실행
   */
  async runBatchAnalysis(): Promise<UserTypeClassification> {
    this.logger.log('========== 배치 분석 워크플로우 시작 ==========');

    try {
      // 1. 모든 요금제 조회
      const plans = await this.prisma.rawPlan.findMany({
        orderBy: {
          pricePromo: 'asc',
        },
      });

      this.logger.log(`전체 요금제 ${plans.length}개 조회 완료`);

      if (plans.length === 0) {
        this.logger.warn('분석할 요금제가 없습니다');
        return {
          navigation: [],
          subLine: [],
          tablet: [],
          kidsSenior: [],
          business: [],
          promotion: [],
          lifetime: [],
        };
      }

      // 2. 청크 단위 배치 분석 (Map 단계)
      const chunkResults = await this.analyzeInChunks(plans);

      // 3. 결과 통합 (Reduce 단계)
      const merged = this.mergeChunkResults(chunkResults, plans);

      this.logger.log('========== 배치 분석 워크플로우 완료 ==========');
      this.logger.log(`최종 결과:`);
      this.logger.log(`- 네비게이션용: ${merged.navigation.length}개`);
      this.logger.log(`- 서브회선/세컨드폰용: ${merged.subLine.length}개`);
      this.logger.log(`- 태블릿/스마트기기용: ${merged.tablet.length}개`);
      this.logger.log(`- 어린이/시니어용: ${merged.kidsSenior.length}개`);
      this.logger.log(`- 업무/비즈니스용: ${merged.business.length}개`);
      this.logger.log(`- 프로모션 한정: ${merged.promotion.length}개`);
      this.logger.log(`- 평생형/상시할인: ${merged.lifetime.length}개`);

      return merged;
    } catch (error) {
      this.logger.error('배치 분석 워크플로우 실패:', error);
      throw error;
    }
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
      planName: plan.planName, // 요금제 이름
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
   * 랭킹 해시 생성: TOP N 요금제의 dataHash 조합으로 해시 생성
   * (id 대신 dataHash 사용으로 요금제 스펙 기반 랭킹 변경 감지)
   */
  private generateRankingHash(plans: RawPlan[]): string {
    const crypto = require('crypto');
    const dataHashes = plans
      .slice(0, 10) // TOP 10
      .map((p) => p.dataHash) // dataHash 기준으로 변경 (id 제거)
      .sort()
      .join('|');

    return crypto.createHash('sha256').update(dataHashes).digest('hex');
  }

  /**
   * 현재 날짜가 해당 월의 몇째주인지 계산
   * @param date 계산할 날짜 (기본값: 오늘)
   * @returns 몇째주 (1~5)
   */
  private getWeekOfMonth(date: Date = new Date()): number {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    // 해당 월의 1일
    const firstDay = new Date(year, month, 1);

    // 1일이 무슨 요일인지 (0: 일요일 ~ 6: 토요일)
    const firstDayOfWeek = firstDay.getDay();

    // 첫째주 시작을 월요일 기준으로 계산
    // 1일이 일요일이면 다음 주 월요일부터 1주차
    const offset = firstDayOfWeek === 0 ? 1 : 8 - firstDayOfWeek;

    // 현재 날짜가 첫째주 시작 이전이면 1주차
    if (day < offset) {
      return 1;
    }

    // 첫째주 시작 이후의 날짜 수를 7로 나눠서 주차 계산
    const weekNumber = Math.ceil((day - offset + 1) / 7) + 1;

    return weekNumber;
  }

  /**
   * 현재 주의 시작일 계산 (일요일 기준)
   */
  private getWeekStart(date: Date = new Date()): Date {
    const d = new Date(date);
    const day = d.getDay(); // 0 (일요일) ~ 6 (토요일)
    const diff = d.getDate() - day; // 일요일로 이동
    return new Date(d.setDate(diff));
  }

  /**
   * 현재 주의 종료일 계산 (토요일 23:59:59)
   */
  private getWeekEnd(date: Date = new Date()): Date {
    const weekStart = this.getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return weekEnd;
  }

  /**
   * 이번 주에 발행된 포스트 조회
   */
  private async getThisWeekPost(): Promise<any | null> {
    const weekStart = this.getWeekStart();
    const weekEnd = this.getWeekEnd();

    return await this.prisma.postQueue.findFirst({
      where: {
        status: 'PUBLISHED',
        publishedAt: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
      orderBy: {
        publishedAt: 'desc',
      },
    });
  }

  /**
   * 가장 최근 랭킹 스냅샷 조회
   */
  private async getLatestRankingSnapshot(): Promise<any | null> {
    return await this.prisma.rankingSnapshot.findFirst({
      orderBy: {
        analysisDate: 'desc',
      },
      include: {
        rankedPlans: true,
      },
    });
  }

  /**
   * 5️⃣ HTML 포스트를 PostQueue에 저장
   *
   * - 이번 주에 발행된 포스트가 있으면 REVISION (수정)
   * - 없으면 NEW_POST (신규)
   *
   * @param htmlPost 정제된 HTML 포스트
   * @param rankingSnapshotId 랭킹 스냅샷 ID
   */
  private async saveHtmlToQueue(htmlPost: HtmlPost, rankingSnapshotId: number): Promise<void> {
    try {
      // 이번 주에 발행된 포스트 확인
      const thisWeekPost = await this.getThisWeekPost();

      if (thisWeekPost && thisWeekPost.originalPostId) {
        // 이번 주에 이미 발행된 글이 있으면 수정 작업으로 등록
        await this.prisma.postQueue.create({
          data: {
            postType: 'REVISION',
            originalPostId: thisWeekPost.originalPostId,
            rankingSnapshotId: rankingSnapshotId,
            title: htmlPost.title,
            htmlBody: htmlPost.htmlBody,
            tags: htmlPost.tags,
            status: 'PENDING',
          },
        });

        this.logger.log(
          `기존 포스트 수정 큐에 저장 완료: ${htmlPost.title} (원본 ID: ${thisWeekPost.originalPostId})`,
        );
      } else {
        // 이번 주에 발행된 글이 없으면 신규 작성
        await this.prisma.postQueue.create({
          data: {
            postType: 'NEW_POST',
            rankingSnapshotId: rankingSnapshotId,
            title: htmlPost.title,
            htmlBody: htmlPost.htmlBody,
            tags: htmlPost.tags,
            status: 'PENDING',
          },
        });

        this.logger.log(`신규 포스트 큐에 저장 완료: ${htmlPost.title}`);
      }
    } catch (error) {
      this.logger.error(`HTML 포스트 큐 저장 실패:`, error);
      throw error;
    }
  }

  /**
   * 3️⃣ Gemini로 블로그 HTML 포스트 생성
   *
   * 유형별 TOP10 요금제를 기반으로 SEO 최적화된 HTML 블로그 생성
   * - 데이터 중심의 자연스러운 설명체
   * - <h2>, <h3>, <table> 구조 사용
   * - 불필요한 아이콘/이모지 없음
   *
   * @param mergedResults 유형별 통합된 TOP10 요금제
   * @returns HtmlPost (title, htmlBody, tags, description)
   */
  private async generateBlogPost(mergedResults: UserTypeClassification): Promise<HtmlPost> {
    this.logger.log('Gemini 블로그 HTML 생성 시작...');

    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth() + 1;

      // 유형별 요금제를 JSON 문자열로 변환 (7가지 카테고리)
      const formattedData = {
        네비게이션용: this.formatPlansForBlog(mergedResults.navigation),
        서브회선세컨드폰용: this.formatPlansForBlog(mergedResults.subLine),
        태블릿스마트기기용: this.formatPlansForBlog(mergedResults.tablet),
        어린이시니어용: this.formatPlansForBlog(mergedResults.kidsSenior),
        업무비즈니스용: this.formatPlansForBlog(mergedResults.business),
        프로모션형: this.formatPlansForBlog(mergedResults.promotion),
        평생형: this.formatPlansForBlog(mergedResults.lifetime),
      };

      // 현재 날짜의 주차 계산
      const weekOfMonth = this.getWeekOfMonth(today);
      const day = today.getDate();

      const prompt = `너는 알뜰폰 요금제 데이터를 분석해
사용 목적별로 7가지 카테고리로 분류하고,
각 카테고리마다 하나의 <section>과 하나의 <table>로 구성된
SEO 최적화 HTML 콘텐츠를 생성하는 시스템이다.

설명 문장이나 추천 문구 없이
검색엔진 친화적 <section> 구조와 <table> 데이터만 출력한다.

🧩 분류 카테고리 (총 7개)

1️⃣ 네비게이션용 요금제
차량 내비게이션, 블랙박스, 공기계 등 저용량 데이터 전용
월 0~1GB, 1천~2천원대

2️⃣ 서브회선 / 세컨드폰용 요금제
OTP·인증용, 듀얼심, 업무용 서브폰
100~300분 통화, 1GB 내외, 1~3천원대

3️⃣ 태블릿 / 스마트기기 전용 요금제
태블릿, 러닝패드, IoT 기기 등 데이터 전용
1~10GB, 3~8천원대

4️⃣ 어린이 / 시니어 특화 요금제
간단한 통화 중심, 음성무제한, 소량 데이터
3~5천원대

5️⃣ 업무 / 비즈니스 전용 요금제
통화량 많고, 데이터 5~20GB, 프로모션형 중심
5천~1만원대

6️⃣ 프로모션 한정 요금제
단기 이벤트성 요금제 (3~12개월 할인형)
프로모션 기간 존재 (promotionMonth > 0)

7️⃣ 평생형 / 상시할인 요금제
프로모션 없이 상시 저가형 (promotionMonth = "평생" 또는 999)
장기 사용자 중심의 실속 요금제

📋 출력 구조 (카테고리당 단일 테이블)

<section id="category-id" class="plan-section">
  <h2>네비게이션용 알뜰폰 요금제 TOP 15 (통신사별 추천)</h2>
  <p class="desc">차량 내비게이션과 블랙박스에 적합한 소량 데이터 알뜰폰 요금제 비교표입니다.</p>

  <table class="plan-table" aria-label="네비게이션용 알뜰폰 요금제 비교표">
    <thead>
      <tr>
        <th scope="col">통신망</th>
        <th scope="col">기술</th>
        <th scope="col">요금제명</th>
        <th scope="col">사업자</th>
        <th scope="col">데이터</th>
        <th scope="col">통화</th>
        <th scope="col">월 요금</th>
        <th scope="col">프로모션 기간</th>
        <th scope="col">프로모션 종료 후 요금</th>
        <th scope="col">혜택</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="10" class="carrier-sep">LG U+</td></tr>
      …LG U+ 5개…
      <tr><td colspan="10" class="carrier-sep">KT</td></tr>
      …KT 5개…
      <tr><td colspan="10" class="carrier-sep">SKT</td></tr>
      …SKT 5개…
    </tbody>
  </table>
</section>

🔧 데이터 처리 규칙

통신사 순서: LG U+ → KT → SKT
통신사별 최대 5개 (Top 5)
내부 정렬: 월 요금 오름차순
promotionMonth 해석:
  null, undefined, 0, "null개월", "평생", 999 → "평생"
  숫자면 "\${promotionMonth}개월"
afterPromotionPrice 없으면 "-"
benefits 배열은 쉼표로 결합, 없으면 "-"
network 정규화:
  "lguplus", "lg u+", "lg" → "LG U+"
  "kt", "olleh" → "KT"
  "skt", "sk telecom" → "SKT"
가격 천 단위 표기: "3,300원"
데이터 결합: "10GB + 3Mbps"
null/undefined 값은 "-"

⚙️ SEO 구조 규칙

<section> = 카테고리 구분 단위
<h2> = "알뜰폰 요금제 + 카테고리명 + TOP" 형태
<p class="desc"> = 카테고리 핵심 키워드 요약문 (AI 자동 생성 허용)
<table aria-label> = 접근성 및 SEO 인덱싱 강화
<th scope="col"> = 구조화 데이터 인식 지원
<tr class="carrier-sep"> = 통신사 구분 시각화
설명문, 요약문, 불필요한 텍스트 출력 금지

📎 입력 데이터
${JSON.stringify(formattedData, null, 2)}

💡 출력 예시

<section id="promotion" class="plan-section">
  <h2>프로모션 한정 알뜰폰 요금제 TOP 15 (기간 한정 할인형)</h2>
  <p class="desc">3~12개월 단기 프로모션으로 구성된 알뜰폰 요금제 모음입니다.</p>
  <table class="plan-table" aria-label="프로모션 한정 알뜰폰 요금제 비교표">
    <thead>
      <tr>
        <th scope="col">통신망</th>
        <th scope="col">기술</th>
        <th scope="col">요금제명</th>
        <th scope="col">사업자</th>
        <th scope="col">데이터</th>
        <th scope="col">통화</th>
        <th scope="col">월 요금</th>
        <th scope="col">프로모션 기간</th>
        <th scope="col">프로모션 종료 후 요금</th>
        <th scope="col">혜택</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="10" class="carrier-sep">LG U+</td></tr>
      <tr>
        <td>LG U+</td>
        <td>LTE</td>
        <td>[N페이 5천P] 토스 실속 300분 5.5GB+</td>
        <td>토스모바일</td>
        <td>5.5GB</td>
        <td>300분</td>
        <td>180원</td>
        <td>6개월</td>
        <td>3,300원</td>
        <td>네이버페이 5천P</td>
      </tr>
      <tr><td colspan="10" class="carrier-sep">KT</td></tr>
      …KT 요금제 5개…
      <tr><td colspan="10" class="carrier-sep">SKT</td></tr>
      …SKT 요금제 5개…
    </tbody>
  </table>
</section>

<section id="lifetime" class="plan-section">
  <h2>평생형 알뜰폰 요금제 TOP 15 (상시할인형)</h2>
  <p class="desc">프로모션 없이 항상 동일 요금으로 이용 가능한 장기 실속형 알뜰폰 요금제입니다.</p>
  <table class="plan-table" aria-label="평생형 알뜰폰 요금제 비교표">
    <thead>
      <tr>
        <th scope="col">통신망</th>
        <th scope="col">기술</th>
        <th scope="col">요금제명</th>
        <th scope="col">사업자</th>
        <th scope="col">데이터</th>
        <th scope="col">통화</th>
        <th scope="col">월 요금</th>
        <th scope="col">프로모션 기간</th>
        <th scope="col">프로모션 종료 후 요금</th>
        <th scope="col">혜택</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="10" class="carrier-sep">LG U+</td></tr>
      …LG U+ 평생형 5개…
      <tr><td colspan="10" class="carrier-sep">KT</td></tr>
      …KT 평생형 5개…
      <tr><td colspan="10" class="carrier-sep">SKT</td></tr>
      …SKT 평생형 5개…
    </tbody>
  </table>
</section>

최종 출력(JSON):
{
  "title": "${year}년 ${month}월 ${weekOfMonth}째주 알뜰폰 요금제 추천 TOP 35 (${month}월 ${day}일 수정)",
  "htmlBody": "<section id=\\"navigation\\" class=\\"plan-section\\">...</section><section id=\\"sub-line\\">...</section>...",
  "tags": ["알뜰폰", "요금제", "가성비", "무제한", "네비게이션용", "프로모션"],
  "description": "150자 이내 요약"
}

✅ SEO 포인트 요약:
- <section>: 각 주제별 콘텐츠 블록
- <h2>: 검색엔진이 인식하는 핵심 키워드 영역
- <p class="desc">: 구글·네이버 스니펫용 요약문
- <table aria-label>: "비교", "추천", "요금제" 키워드 인덱싱 강화
- <th scope="col">: 데이터 구조 명확화
- 평생형/프로모션형 분리: 키워드 다양성 및 CTR(클릭률) 향상

반드시 순수 JSON만 반환하고, 코드 블록(\`\`\`json) 사용 금지.`;

      const response = await this.callGemini(prompt);

      // JSON 파싱
      let parsed: HtmlPost;
      try {
        parsed = JSON.parse(response);
      } catch (parseError) {
        this.logger.error('Gemini 응답 JSON 파싱 실패:', parseError);
        this.logger.debug(`응답 내용: ${response.substring(0, 500)}...`);

        // Graceful degrade: 기본 구조 생성
        const weekOfMonth = this.getWeekOfMonth(today);
        const day = today.getDate();
        parsed = {
          title: `${year}년 ${month}월 ${weekOfMonth}째주 알뜰폰 요금제 추천 TOP 35 (${month}월 ${day}일 수정)`,
          htmlBody: this.buildFallbackHtml(mergedResults),
          tags: ['알뜰폰', '요금제', '가성비', '무제한', '보조폰', '네비게이션용', '프로모션'],
          description: `${year}년 ${month}월 최신 알뜰폰 요금제 7가지 카테고리별 비교 분석`,
        };
      }

      // 응답 검증
      if (!parsed.htmlBody || parsed.htmlBody.length < 500) {
        this.logger.warn(`생성된 HTML이 너무 짧습니다 (${parsed.htmlBody?.length || 0}자)`);
      }

      this.logger.log(`블로그 생성 완료: ${parsed.title}`);

      return {
        title: parsed.title,
        htmlBody: parsed.htmlBody,
        tags: parsed.tags || ['알뜰폰', '요금제', '가성비', '무제한', '네비게이션용', '프로모션'],
        description: parsed.description || `${year}년 ${month}월 최신 알뜰폰 요금제 7가지 카테고리별 비교`,
      };
    } catch (error) {
      this.logger.error('블로그 HTML 생성 실패:', error);

      // 에러 발생 시에도 Fallback HTML 반환 (throw 대신)
      const nowFallback = new Date();
      const yearFallback = nowFallback.getFullYear();
      const monthFallback = nowFallback.getMonth() + 1;
      const weekOfMonthFallback = this.getWeekOfMonth(nowFallback);
      const dayFallback = nowFallback.getDate();

      return {
        title: `${yearFallback}년 ${monthFallback}월 ${weekOfMonthFallback}째주 알뜰폰 요금제 추천 TOP 35 (${monthFallback}월 ${dayFallback}일 수정)`,
        htmlBody: this.buildFallbackHtml(mergedResults),
        tags: ['알뜰폰', '요금제', '가성비', '무제한', '보조폰', '네비게이션용', '프로모션'],
        description: `${yearFallback}년 ${monthFallback}월 최신 알뜰폰 요금제 7가지 카테고리별 비교 분석`,
      };
    }
  }

  /**
   * 통신사 정규화 헬퍼 함수
   */
  private normalizeNetwork(network: string): string {
    const normalized = network.toLowerCase().trim();
    if (normalized.includes('lgu') || normalized.includes('lg u+') || normalized === 'lg') {
      return 'LG U+';
    } else if (normalized.includes('kt') || normalized.includes('olleh')) {
      return 'KT';
    } else if (
      normalized.includes('skt') ||
      normalized.includes('sk telecom') ||
      normalized === 'sk'
    ) {
      return 'SKT';
    }
    return network; // 원본 반환
  }

  /**
   * 통신사별 정렬 우선순위
   */
  private getNetworkPriority(network: string): number {
    const normalized = this.normalizeNetwork(network);
    switch (normalized) {
      case 'LG U+':
        return 1;
      case 'KT':
        return 2;
      case 'SKT':
        return 3;
      default:
        return 999; // 기타 통신사는 맨 뒤
    }
  }

  /**
   * 요금제 목록을 블로그용 JSON 포맷으로 변환 (통신사별 정렬 포함)
   */
  private formatPlansForBlog(plans: RawPlan[]): any[] {
    // 1. 통신사별 정렬 (LG U+ → KT → SKT), 그 다음 월 요금 오름차순
    const sorted = [...plans].sort((a, b) => {
      const priorityA = this.getNetworkPriority(a.network);
      const priorityB = this.getNetworkPriority(b.network);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // 같은 통신사 내에서는 월 요금 오름차순
      return a.pricePromo - b.pricePromo;
    });

    // 2. JSON 포맷으로 변환
    return sorted.map((plan) => ({
      planName: plan.planName,
      mvno: plan.mvno,
      network: this.normalizeNetwork(plan.network),
      technology: plan.technology, // LTE 또는 5G
      dataGB: plan.dataBaseGB === 999 ? '무제한' : `${plan.dataBaseGB}GB`,
      dataSpeedMbps: plan.dataPostSpeedMbps ? `${plan.dataPostSpeedMbps}Mbps` : null,
      talk: plan.talkMinutes === 9999 ? '무제한' : `${plan.talkMinutes}분`,
      price: `${plan.pricePromo.toLocaleString()}원`,
      priceOriginal: plan.priceOriginal ? `${plan.priceOriginal.toLocaleString()}원` : null,
      promotion:
        plan.promotionDurationMonths === 999 ? '평생' : `${plan.promotionDurationMonths}개월`,
      benefits: plan.benefitSummary || null,
    }));
  }

  /**
   * Gemini 응답 실패 시 Fallback HTML 생성 (7가지 카테고리)
   */
  private buildFallbackHtml(mergedResults: UserTypeClassification): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    let html = `<h2>${year}년 ${month}월 알뜰폰 요금제 추천 (사용 목적별 맞춤형)</h2>\n`;
    html += `<p>최신 알뜰폰 요금제를 7가지 사용 목적별로 정리했습니다.</p>\n`;

    const sections = [
      { key: 'navigation', title: '네비게이션용 요금제', id: 'navigation' },
      { key: 'subLine', title: '서브회선/세컨드폰용 요금제', id: 'sub-line' },
      { key: 'tablet', title: '태블릿/스마트기기 전용 요금제', id: 'tablet' },
      { key: 'kidsSenior', title: '어린이/시니어 특화 요금제', id: 'kids-senior' },
      { key: 'business', title: '업무/비즈니스 전용 요금제', id: 'business' },
      { key: 'promotion', title: '프로모션 한정 요금제', id: 'promotion' },
      { key: 'lifetime', title: '평생형/상시할인 요금제', id: 'lifetime' },
    ];

    for (const section of sections) {
      const plans = mergedResults[section.key as keyof UserTypeClassification];
      if (plans.length > 0) {
        html += `<section id="${section.id}" class="plan-section">\n`;
        html += `  <h3>${section.title}</h3>\n`;
        html += `  <table class="plan-table">\n`;
        html += `    <thead>\n`;
        html += `      <tr>\n`;
        html += `        <th scope="col">통신망</th>\n`;
        html += `        <th scope="col">기술</th>\n`;
        html += `        <th scope="col">요금제명</th>\n`;
        html += `        <th scope="col">사업자</th>\n`;
        html += `        <th scope="col">데이터</th>\n`;
        html += `        <th scope="col">통화</th>\n`;
        html += `        <th scope="col">월 요금</th>\n`;
        html += `        <th scope="col">프로모션 기간</th>\n`;
        html += `      </tr>\n`;
        html += `    </thead>\n`;
        html += `    <tbody>\n`;

        // 통신사별 정렬
        const sortedPlans = [...plans]
          .sort((a, b) => {
            const priorityA = this.getNetworkPriority(a.network);
            const priorityB = this.getNetworkPriority(b.network);
            if (priorityA !== priorityB) return priorityA - priorityB;
            return a.pricePromo - b.pricePromo;
          })
          .slice(0, 10);

        let currentNetwork = '';
        sortedPlans.forEach((plan) => {
          const network = this.normalizeNetwork(plan.network);
          if (network !== currentNetwork) {
            currentNetwork = network;
            html += `      <tr><td colspan="8" class="carrier-sep">${network}</td></tr>\n`;
          }

          const talk = plan.talkMinutes === 9999 ? '무제한' : `${plan.talkMinutes}분`;
          const data =
            plan.dataBaseGB === 999
              ? '무제한'
              : plan.dataPostSpeedMbps
                ? `${plan.dataBaseGB}GB + ${plan.dataPostSpeedMbps}Mbps`
                : `${plan.dataBaseGB}GB`;
          const promo =
            plan.promotionDurationMonths === 999 ? '평생' : `${plan.promotionDurationMonths}개월`;

          html += `      <tr>\n`;
          html += `        <td>${network}</td>\n`;
          html += `        <td>${plan.technology}</td>\n`;
          html += `        <td>${plan.planName}</td>\n`;
          html += `        <td>${plan.mvno}</td>\n`;
          html += `        <td>${data}</td>\n`;
          html += `        <td>${talk}</td>\n`;
          html += `        <td>${plan.pricePromo.toLocaleString()}원</td>\n`;
          html += `        <td>${promo}</td>\n`;
          html += `      </tr>\n`;
        });

        html += `    </tbody>\n`;
        html += `  </table>\n`;
        html += `</section>\n\n`;
      }
    }

    return html;
  }

  /**
   * 4️⃣ Claude 스타일 HTML 후처리 (AI 느낌 제거)
   *
   * Gemini가 생성한 HTML에서 AI 특유의 과장된 표현과 불필요한 강조를 제거하고
   * 자연스러운 블로그 문체로 정제
   *
   * 수행 내용:
   * - 이모지/아이콘 전체 제거
   * - <strong>/<em> 남발 제거 (데이터 숫자만 유지)
   * - 반복되는 키워드 줄이기
   * - 과장된 표현 삭제 ("지금 바로", "꼭 확인" 등)
   * - <h2>, <table> 구조 유지
   * - 자연스러운 블로그 문체로 재정리
   *
   * @param html Gemini가 생성한 원본 HTML
   * @returns 정제된 HTML 문자열
   */
  private refineHtmlContent(html: string): string {
    this.logger.log('Claude 스타일 HTML 후처리 시작...');

    let refined = html;

    // 1. 이모지 전체 제거 (유니코드 이모지 범위)
    refined = refined.replace(
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}]/gu,
      '',
    );

    // 2. HTML 엔티티 이모지 제거 (&#...; 형태)
    refined = refined.replace(/&#x?[0-9a-fA-F]+;/g, '');

    // 3. 흔한 텍스트 이모지 제거
    const textEmojis = ['📌', '💰', '🏆', '💡', '📝', '🎯', '⚠️', '✅', '❌', '👍', '📊'];
    textEmojis.forEach((emoji) => {
      refined = refined.replace(new RegExp(emoji, 'g'), '');
    });

    // 4. <strong> 태그 과다 사용 제거 (숫자 데이터만 유지)
    // 예: <strong>2025년 알뜰폰 요금제</strong> → 2025년 알뜰폰 요금제
    refined = refined.replace(/<strong>([^0-9<>]*?)<\/strong>/g, '$1');

    // 5. <em> 태그 제거
    refined = refined.replace(/<em>(.*?)<\/em>/g, '$1');

    // 6. 과장된 표현 제거
    const exaggerations = [
      '지금 바로',
      '꼭 확인하세요',
      '절대 놓치지 마세요',
      '반드시 체크',
      '강력 추천',
      '최고의 선택',
      '완벽한',
      '놀라운',
      '대박',
      '혜택 팡팡',
      '초특가',
    ];

    exaggerations.forEach((phrase) => {
      refined = refined.replace(new RegExp(phrase, 'g'), '');
    });

    // 7. 연속된 공백 정리
    refined = refined.replace(/\s{2,}/g, ' ');

    // 8. 빈 태그 제거 (내용 없는 <p>, <strong> 등)
    refined = refined.replace(/<p>\s*<\/p>/g, '');
    refined = refined.replace(/<strong>\s*<\/strong>/g, '');
    refined = refined.replace(/<em>\s*<\/em>/g, '');

    // 9. 반복되는 키워드 줄이기
    // "2025년 알뜰폰 요금제"가 3번 이상 연속으로 나오면 2번으로 줄임
    const year = new Date().getFullYear();
    const repetitiveKeyword = `${year}년 알뜰폰 요금제`;
    const regex = new RegExp(`(${repetitiveKeyword}.*?){3,}`, 'g');
    refined = refined.replace(regex, (match) => {
      // 3번 이상 반복되는 경우 2번만 남김
      return match.replace(new RegExp(repetitiveKeyword, 'g'), (m, idx) =>
        idx < 2 ? m : '요금제',
      );
    });

    // 10. 문단 정리: 3문장 이상인 <p> 태그를 2~3문장으로 압축
    refined = refined.replace(/<p>(.*?)<\/p>/gs, (match, content) => {
      const sentences = content.split(/[.!?]\s+/);
      if (sentences.length > 3) {
        // 앞 2문장만 유지
        const trimmed = sentences.slice(0, 2).join('. ') + '.';
        return `<p>${trimmed}</p>`;
      }
      return match;
    });

    // 11. 빈 줄 정리 (연속된 \n 제거)
    refined = refined.replace(/\n{3,}/g, '\n\n');

    // 12. 마지막 공백 정리
    refined = refined.trim();

    this.logger.log('HTML 후처리 완료');
    this.logger.debug(`Before: ${html.length}자 → After: ${refined.length}자`);

    return refined;
  }

  /**
   * 📌 메인 워크플로우: 전체 분석 파이프라인 실행
   *
   * 1️⃣ 요금제 데이터를 300개 단위로 나눠 Gemini에 병렬 분석 (유형별 TOP5 JSON 생성)
   * 2️⃣ 결과를 합쳐 유형별 TOP10 요금제 구조로 통합
   * 3️⃣ Gemini로 블로그 HTML 포스트를 생성
   * 4️⃣ 생성된 HTML 그대로 PostQueue에 저장 (별도 후처리 없음)
   *
   * @returns 분석 결과 요약
   */
  async runFullAnalysis(): Promise<{
    totalPlans: number;
    processed: number;
    failed: number;
    success: boolean;
    hasChanges: boolean;
  }> {
    try {
      this.logger.log('========== 전체 분석 워크플로우 시작 ==========');

      // Step 1: 모든 요금제 조회
      const plans = await this.prisma.rawPlan.findMany({
        orderBy: {
          pricePromo: 'asc',
        },
      });
      this.logger.log(`전체 요금제 ${plans.length}개 조회 완료`);

      if (plans.length === 0) {
        this.logger.warn('분석할 요금제가 없습니다');
        return {
          totalPlans: 0,
          processed: 0,
          failed: 0,
          success: true,
          hasChanges: false,
        };
      }

      // Step 2: 현재 랭킹 해시 생성 (TOP 10 기준)
      const currentRankingHash = this.generateRankingHash(plans);
      this.logger.log(`현재 랭킹 해시: ${currentRankingHash.substring(0, 12)}...`);

      // Step 3: 가장 최근 랭킹 스냅샷 조회 (변경 감지)
      const latestSnapshot = await this.getLatestRankingSnapshot();

      if (latestSnapshot) {
        this.logger.log(`이전 랭킹 해시: ${latestSnapshot.rankingHash.substring(0, 12)}...`);

        // 랭킹이 변경되지 않았으면 스킵
        if (latestSnapshot.rankingHash === currentRankingHash) {
          this.logger.log('랭킹 변경 없음 - 분석 건너뛰기');
          return {
            totalPlans: plans.length,
            processed: 0,
            failed: 0,
            success: true,
            hasChanges: false,
          };
        }

        this.logger.log('랭킹 변경 감지 - 새 분석 시작');
      } else {
        this.logger.log('최초 분석 - 랭킹 스냅샷 생성');
      }

      // Step 4: 1️⃣ Gemini 병렬 배치 분석 (300개씩 나눠서 유형별 TOP5 추출)
      this.logger.log('1️⃣ Gemini 병렬 배치 분석 시작...');
      const chunkResults = await this.analyzeInChunks(plans);

      // Step 5: 2️⃣ 유형별 통합 (중복 제거 + TOP10 선정)
      this.logger.log('2️⃣ 유형별 결과 통합 시작...');
      const mergedResults = this.mergeChunkResults(chunkResults, plans);

      // Step 6: 3️⃣ Gemini 블로그 HTML 생성
      this.logger.log('3️⃣ Gemini 블로그 HTML 생성 시작...');
      const blog = await this.generateBlogPost(mergedResults);

      // Step 7: 랭킹 스냅샷 생성 및 TOP 10 요금제 연결
      const top10Plans = plans.slice(0, 10);
      const rankingSnapshot = await this.prisma.rankingSnapshot.create({
        data: {
          rankingHash: currentRankingHash,
          topCount: top10Plans.length,
          analysisData: {
            userTypes: {
              navigation: mergedResults.navigation?.length || 0,
              subLine: mergedResults.subLine?.length || 0,
              tablet: mergedResults.tablet?.length || 0,
              kidsSenior: mergedResults.kidsSenior?.length || 0,
              business: mergedResults.business?.length || 0,
              promotion: mergedResults.promotion?.length || 0,
              lifetime: mergedResults.lifetime?.length || 0,
            },
          },
          rankedPlans: {
            connect: top10Plans.map((p) => ({ id: p.id })),
          },
        },
      });

      this.logger.log(`랭킹 스냅샷 생성 완료 (ID: ${rankingSnapshot.id})`);

      // Step 8: 4️⃣ PostQueue에 저장 (신규 or 수정)
      this.logger.log('4️⃣ PostQueue 저장 시작...');
      await this.saveHtmlToQueue(
        {
          title: blog.title,
          htmlBody: blog.htmlBody,
          tags: blog.tags,
          description: blog.description,
        },
        rankingSnapshot.id,
      );

      this.logger.log('========== 전체 분석 워크플로우 완료 ==========');
      this.logger.log(`최종 포스트: ${blog.title}`);

      return {
        totalPlans: plans.length,
        processed: 1,
        failed: 0,
        success: true,
        hasChanges: true,
      };
    } catch (error) {
      this.logger.error('전체 분석 워크플로우 실패:', error);
      return {
        totalPlans: 0,
        processed: 0,
        failed: 1,
        success: false,
        hasChanges: false,
      };
    }
  }
}
