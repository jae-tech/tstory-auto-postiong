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
 * 사용자 유형별 요금제 분류 결과 (2025년 실사용 목적 기준)
 */
interface UserTypeClassification {
  subLine: RawPlan[]; // 서브회선용 초저가 요금제
  carNavi: RawPlan[]; // 차량 네비게이션용 요금제
  business: RawPlan[]; // 업무·영업용 실속 요금제
  throttledUnlimited: RawPlan[]; // 속도제한 무제한형 요금제
  promotion: RawPlan[]; // 프로모션형 '메뚜기족' 요금제
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
   * 배치 분석을 위한 Gemini 프롬프트 생성
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

아래 5가지 사용자 유형으로 분류하고, 각 유형별 TOP5 요금제를 JSON 형태로 반환하세요.

유형 분류 기준 (2025년 실사용 목적 기준):

1️⃣ **서브회선용 초저가 요금제**
   - 보조폰, 아이폰 세컨드폰, 자녀폰용
   - 데이터 3GB 이하, 월 1만원 미만

2️⃣ **차량 네비게이션용 요금제**
   - 차량 내비, 블랙박스, IoT 장비용
   - 데이터 3~10GB, 월 1만원 이하

3️⃣ **업무·영업용 실속 요금제**
   - 통화량 많고 데이터는 중간 정도
   - 통화 1000분 이상 또는 무제한, 데이터 3~10GB

4️⃣ **속도제한 무제한형 요금제**
   - 데이터 많이 쓰지만 저렴한 무제한을 찾는 사용자
   - 데이터 100GB 이상 or 속도제한 3~5Mbps 이상

5️⃣ **프로모션형 '메뚜기족' 요금제**
   - 3~6개월 단기 할인 프로모션 중심
   - promotionDurationMonths 값이 1~6개월

반환 형식 (반드시 유효한 JSON만 출력):
{
  "서브회선용 초저가 요금제": [요금제 id 배열 (최대 5개)],
  "차량 네비게이션용 요금제": [요금제 id 배열 (최대 5개)],
  "업무·영업용 실속 요금제": [요금제 id 배열 (최대 5개)],
  "속도제한 무제한형 요금제": [요금제 id 배열 (최대 5개)],
  "프로모션형 메뚜기족 요금제": [요금제 id 배열 (최대 5개)]
}

예시:
{
  "서브회선용 초저가 요금제": [123, 456, 789, 234, 567],
  "차량 네비게이션용 요금제": [234, 567, 890, 345, 678],
  "업무·영업용 실속 요금제": [345, 678, 901, 456, 789],
  "속도제한 무제한형 요금제": [456, 789, 012, 567, 890],
  "프로모션형 메뚜기족 요금제": [567, 890, 123, 678, 901]
}

주의사항:
- 반드시 순수 JSON 형태로만 응답하세요
- 코드 블록(\`\`\`json) 사용 금지
- 각 유형별 최대 5개까지만 선정
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
   * 청크 결과 통합: 유형별로 합치고 상위 10개만 남김
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
      subLine: new Set(),
      carNavi: new Set(),
      business: new Set(),
      throttledUnlimited: new Set(),
      promotion: new Set(),
    };

    // 한글 키 → 영문 키 매핑
    const koreanToEnglishKey: Record<string, keyof UserTypeClassification> = {
      '서브회선용 초저가 요금제': 'subLine',
      '차량 네비게이션용 요금제': 'carNavi',
      '업무·영업용 실속 요금제': 'business',
      '속도제한 무제한형 요금제': 'throttledUnlimited',
      '프로모션형 메뚜기족 요금제': 'promotion',
    };

    // 영문 키 → 한글 키 매핑 (로깅용)
    const englishToKoreanKey: Record<string, string> = {
      subLine: '서브회선용 초저가',
      carNavi: '차량 네비게이션용',
      business: '업무·영업용 실속',
      throttledUnlimited: '속도제한 무제한형',
      promotion: '프로모션형 메뚜기족',
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
      subLine: [],
      carNavi: [],
      business: [],
      throttledUnlimited: [],
      promotion: [],
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
          subLine: [],
          carNavi: [],
          business: [],
          throttledUnlimited: [],
          promotion: [],
        };
      }

      // 2. 청크 단위 배치 분석 (Map 단계)
      const chunkResults = await this.analyzeInChunks(plans);

      // 3. 결과 통합 (Reduce 단계)
      const merged = this.mergeChunkResults(chunkResults, plans);

      this.logger.log('========== 배치 분석 워크플로우 완료 ==========');
      this.logger.log(`최종 결과:`);
      this.logger.log(`- 서브회선용 초저가: ${merged.subLine.length}개`);
      this.logger.log(`- 차량 네비게이션용: ${merged.carNavi.length}개`);
      this.logger.log(`- 업무·영업용 실속: ${merged.business.length}개`);
      this.logger.log(`- 속도제한 무제한형: ${merged.throttledUnlimited.length}개`);
      this.logger.log(`- 프로모션형 메뚜기족: ${merged.promotion.length}개`);

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

      // 유형별 요금제를 JSON 문자열로 변환 (Gemini API는 한글 키 사용)
      const formattedData = {
        서브회선용_초저가_요금제: this.formatPlansForBlog(mergedResults.subLine),
        차량_네비게이션용_요금제: this.formatPlansForBlog(mergedResults.carNavi),
        업무_영업용_실속_요금제: this.formatPlansForBlog(mergedResults.business),
        속도제한_무제한형_요금제: this.formatPlansForBlog(mergedResults.throttledUnlimited),
        프로모션형_메뚜기족_요금제: this.formatPlansForBlog(mergedResults.promotion),
      };

      // 현재 날짜의 주차 계산
      const weekOfMonth = this.getWeekOfMonth(today);
      const day = today.getDate();

      const prompt = `너는 데이터 중심의 블로거다.
아래는 알뜰폰 요금제 분석 결과이다:

${JSON.stringify(formattedData, null, 2)}

HTML 블로그 글을 생성하라.

규칙:
1. <h2>로 5개 섹션 구성: 서브회선용 초저가 / 차량 네비게이션용 / 업무·영업용 실속 / 속도제한 무제한형 / 프로모션형 메뚜기족
2. 각 섹션은 2~3문장 개요 + <table> 비교표 + 2~3문장 분석
3. 제목: "${year}년 ${month}월 ${weekOfMonth}째주 알뜰폰 요금제 추천 TOP 25 (${month}월 ${day}일 수정)"
4. SEO 키워드 '알뜰폰 요금제', '가성비', '보조폰', '무제한', '통신비 절약'을 자연스럽게 포함
5. 아이콘, 이모지, 불필요한 강조 금지
6. HTML 구조는 <h2>, <h3>, <table>, <p>, <ul>, <li>만 사용
7. 문장은 사실 중심, 자연스러운 설명체
8. 표는 반드시 <thead>, <tbody> 구조 사용
9. 각 유형별 설명:
   - 서브회선용 초저가: 보조폰, 세컨드폰, 자녀폰 (데이터 3GB 이하, 1만원 미만)
   - 차량 네비게이션용: 차량 내비, 블랙박스, IoT (데이터 3~10GB, 1만원 이하)
   - 업무·영업용 실속: 통화 많은 사용자 (통화 1000분 이상, 데이터 3~10GB)
   - 속도제한 무제한형: 저렴한 무제한 (데이터 100GB 이상 or 속도 3~5Mbps)
   - 프로모션형 메뚜기족: 단기 할인 (3~6개월 프로모션)

10. 최종 출력(JSON):
{
  "title": "...",
  "htmlBody": "<h2>...</h2><p>...</p>...",
  "tags": ["알뜰폰", "요금제", "가성비", "무제한", "보조폰"],
  "description": "150자 이내 요약"
}

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
          title: `${year}년 ${month}월 ${weekOfMonth}째주 알뜰폰 요금제 추천 TOP 25 (${month}월 ${day}일 수정)`,
          htmlBody: this.buildFallbackHtml(mergedResults),
          tags: ['알뜰폰', '요금제', '가성비', '무제한', '보조폰'],
          description: `${year}년 ${month}월 최신 알뜰폰 요금제 비교 분석`,
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
        tags: parsed.tags || ['알뜰폰', '요금제'],
        description: parsed.description || `${year}년 ${month}월 최신 알뜰폰 요금제 비교`,
      };
    } catch (error) {
      this.logger.error('블로그 HTML 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 요금제 목록을 블로그용 JSON 포맷으로 변환
   */
  private formatPlansForBlog(plans: RawPlan[]): any[] {
    return plans.map((plan) => ({
      planName: plan.planName,
      mvno: plan.mvno,
      network: plan.network,
      dataGB: plan.dataBaseGB === 999 ? '무제한' : `${plan.dataBaseGB}GB`,
      talk: plan.talkMinutes === 9999 ? '무제한' : `${plan.talkMinutes}분`,
      price: `${plan.pricePromo.toLocaleString()}원`,
      promotion:
        plan.promotionDurationMonths === 999 ? '평생' : `${plan.promotionDurationMonths}개월`,
    }));
  }

  /**
   * Gemini 응답 실패 시 Fallback HTML 생성
   */
  private buildFallbackHtml(mergedResults: UserTypeClassification): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;

    let html = `<h2>${year}년 ${month}월 알뜰폰 요금제 추천 (실사용자 맞춤형)</h2>\n`;
    html += `<p>최신 알뜰폰 요금제를 실사용 목적별로 정리했습니다.</p>\n`;

    const sections = [
      { key: 'subLine', title: '서브회선용 초저가 요금제' },
      { key: 'carNavi', title: '차량 네비게이션용 요금제' },
      { key: 'business', title: '업무·영업용 실속 요금제' },
      { key: 'throttledUnlimited', title: '속도제한 무제한형 요금제' },
      { key: 'promotion', title: '프로모션형 메뚜기족 요금제' },
    ];

    for (const section of sections) {
      const plans = mergedResults[section.key as keyof UserTypeClassification];
      if (plans.length > 0) {
        html += `<h3>${section.title}</h3>\n`;
        html += `<table>\n<thead><tr><th>요금제</th><th>사업자</th><th>데이터</th><th>통화</th><th>가격</th></tr></thead>\n<tbody>\n`;

        plans.slice(0, 5).forEach((plan) => {
          const talk = plan.talkMinutes === 9999 ? '무제한' : `${plan.talkMinutes}분`;
          html += `<tr><td>${plan.planName}</td><td>${plan.mvno}</td><td>${plan.dataBaseGB}GB</td><td>${talk}</td><td>${plan.pricePromo.toLocaleString()}원</td></tr>\n`;
        });

        html += `</tbody>\n</table>\n`;
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
              subLine: mergedResults.subLine.length,
              carNavi: mergedResults.carNavi.length,
              business: mergedResults.business.length,
              throttledUnlimited: mergedResults.throttledUnlimited.length,
              promotion: mergedResults.promotion.length,
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
