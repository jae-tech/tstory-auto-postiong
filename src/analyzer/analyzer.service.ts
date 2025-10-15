import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from '@/prisma/prisma.service';
import { RawPlan } from '@prisma/client';

/**
 * Gemini API 분석 결과 인터페이스
 */
interface AnalyzedPost {
  title: string;
  htmlBody: string;
  tags: string[];
}

/**
 * 분석기 서비스: Gemini API를 사용한 요금제 분석 및 블로그 콘텐츠 생성
 */
@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);
  private genAI: GoogleGenAI;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY가 설정되지 않았습니다');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  /**
   * 데이터베이스에서 최근 요금제 조회
   * (새 스키마에는 isProcessed 필드가 없으므로 최신 데이터 조회)
   */
  async getUnprocessedPlans(): Promise<RawPlan[]> {
    return await this.prisma.rawPlan.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: 10, // 배치 단위로 처리
    });
  }

  /**
   * 요금제 데이터 기반 Gemini API 프롬프트 생성
   */
  buildPrompt(plan: RawPlan): string {
    const prompt = `당신은 알뜰폰 요금제 전문 블로거입니다. 다음 요금제 정보를 바탕으로 티스토리 블로그 포스팅을 작성해주세요.

요금제 정보:
- 알뜰폰 사업자: ${plan.mvno}
- 통신망: ${plan.network}
- 통신 기술: ${plan.technology}
- 데이터: ${plan.dataBaseGB === 999 ? '무제한' : plan.dataBaseGB + 'GB'}
- 가격: ${plan.pricePromo.toLocaleString()}원
- 원가: ${plan.priceOriginal ? plan.priceOriginal.toLocaleString() + '원' : '동일'}
- 통화: ${plan.talkMinutes === 9999 ? '무제한' : plan.talkMinutes + '분'}
- 문자: ${plan.smsCount === 9999 ? '무제한' : plan.smsCount + '건'}
- 혜택: ${plan.benefitSummary || '없음'}

작성 요구사항:
1. 매력적이고 클릭을 유도하는 제목 작성 (35자 이내)
2. HTML 형식의 본문 작성 (800-1200자)
   - 요금제 특징 설명
   - 장단점 분석
   - 추천 대상 고객층
   - 다른 요금제와의 비교 포인트
3. SEO 최적화를 위한 관련 태그 5-8개 생성

응답 형식은 반드시 아래 JSON 형식으로 작성해주세요:
{
  "title": "블로그 포스팅 제목",
  "htmlBody": "<h2>제목</h2><p>본문 내용...</p>",
  "tags": ["알뜰폰", "요금제", "통신사명", ...]
}

JSON 형식만 응답하고 다른 텍스트는 포함하지 마세요.`;

    return prompt;
  }

  /**
   * Gemini API를 사용하여 요금제 분석
   */
  async analyzeWithGemini(plan: RawPlan): Promise<AnalyzedPost> {
    this.logger.log(`요금제 분석 중: ${plan.mvno} - ${plan.planId}`);

    try {
      const model = await this.genAI.models;

      const prompt = this.buildPrompt(plan);
      const result = await model.generateContent({
        model: this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash-lite',
        contents: prompt,
      });
      const text = result.text || '';

      // JSON 응답 파싱
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Gemini 응답에서 JSON 추출 실패');
      }

      const parsed: AnalyzedPost = JSON.parse(jsonMatch[0]);

      // 응답 구조 검증
      if (!parsed.title || !parsed.htmlBody || !Array.isArray(parsed.tags)) {
        throw new Error('Gemini 응답 구조가 유효하지 않음');
      }

      this.logger.log(`요금제 분석 완료: ${plan.mvno} - ${plan.planId}`);
      return parsed;
    } catch (error) {
      this.logger.error(`요금제 분석 실패 ${plan.id}:`, error);
      throw error;
    }
  }

  /**
   * 분석된 포스트를 post_queue에 저장
   */
  async saveToQueue(planId: number, analyzedPost: AnalyzedPost): Promise<void> {
    try {
      // 포스트 큐에 추가 (새 스키마에서는 rankingSnapshot 기반)
      await this.prisma.postQueue.create({
        data: {
          title: analyzedPost.title,
          htmlBody: analyzedPost.htmlBody,
          tags: analyzedPost.tags,
          status: 'PENDING',
        },
      });

      this.logger.log(`큐에 저장 완료: Plan ID ${planId}`);
    } catch (error) {
      this.logger.error(`큐 저장 실패: Plan ID ${planId}`, error);
      throw error;
    }
  }

  /**
   * 여러 요금제를 배치로 처리
   */
  async processBatch(plans: RawPlan[]): Promise<{
    processed: number;
    failed: number;
  }> {
    let processed = 0;
    let failed = 0;

    for (const plan of plans) {
      try {
        const analyzedPost = await this.analyzeWithGemini(plan);
        await this.saveToQueue(plan.id, analyzedPost);
        processed++;

        // API 요청 제한 준수를 위한 딜레이 추가
        await this.delay(1000);
      } catch (error) {
        this.logger.error(`요금제 처리 실패 ${plan.id}:`, error);
        failed++;
      }
    }

    return { processed, failed };
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

      const plans = await this.getUnprocessedPlans();
      this.logger.log(`미처리 요금제 ${plans.length}개 발견`);

      if (plans.length === 0) {
        return {
          totalPlans: 0,
          processed: 0,
          failed: 0,
          success: true,
        };
      }

      const result = await this.processBatch(plans);

      return {
        totalPlans: plans.length,
        processed: result.processed,
        failed: result.failed,
        success: true,
      };
    } catch (error) {
      this.logger.error('분석기 워크플로우 실패:', error);
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
