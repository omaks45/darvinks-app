import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // ── Health check — used by Render and load balancers ──────────────────────
  @Get('health')
  health(): { status: string; timestamp: string } {
    return {
      status:    'ok',
      timestamp: new Date().toISOString(),
    };
  }
}