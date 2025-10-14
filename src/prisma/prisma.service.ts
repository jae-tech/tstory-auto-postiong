import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 서비스: PostgreSQL 데이터베이스 연결 관리
 *
 * - onModuleInit: 앱 시작 시 DB 연결
 * - onModuleDestroy: 앱 종료 시 DB 연결 해제
 * - 전역 모듈로 등록되어 모든 서비스에서 주입 가능
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        // Prisma 로그 설정 (개발 환경에서 유용)
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });

    // 쿼리 로그 이벤트 리스너 (개발 시 디버깅용)
    // @ts-ignore
    this.$on('query', (e: any) => {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`Query: ${e.query}`);
        this.logger.debug(`Duration: ${e.duration}ms`);
      }
    });
  }

  /**
   * 모듈 초기화 시 DB 연결
   */
  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('✅ PostgreSQL 데이터베이스 연결 성공');
    } catch (error) {
      this.logger.error('❌ 데이터베이스 연결 실패:', error);
      throw error;
    }
  }

  /**
   * 모듈 종료 시 DB 연결 해제
   */
  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 PostgreSQL 데이터베이스 연결 해제');
  }

  /**
   * 트랜잭션 재시도 헬퍼 메서드
   * 네트워크 일시적 오류 시 자동 재시도
   */
  async executeWithRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `⚠️ DB 작업 실패 (시도 ${attempt}/${maxRetries}):`,
          (error as Error).message,
        );

        if (attempt < maxRetries) {
          // 지수 백오프 (100ms, 400ms, 1600ms)
          await this.delay(Math.pow(2, attempt) * 100);
        }
      }
    }

    throw lastError!;
  }

  /**
   * 딜레이 헬퍼
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
