import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

declare const module: any;

/**
 * NestJS 애플리케이션 부트스트랩
 * Fastify 어댑터를 사용하여 고성능 HTTP 서버 구성
 */
async function bootstrap() {
  // Fastify 어댑터로 NestJS 앱 생성
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true, // Fastify 로거 활성화
      trustProxy: true, // 프록시 환경에서 실행 시 필요
    }),
  );

  // CORS 활성화 (필요 시)
  app.enableCors();

  // 환경 변수로부터 포트 읽기 (기본값: 3000)
  const port = process.env.PORT || 3000;

  // 모든 네트워크 인터페이스에서 리스닝 (Docker 컨테이너 내부에서 필수)
  await app.listen(port, '0.0.0.0');

  console.log(`✅ 애플리케이션이 실행 중입니다: ${await app.getUrl()}`);
  console.log(`📅 Cron 스케줄러가 등록되었습니다`);

  // Webpack HMR 지원
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}

bootstrap();
