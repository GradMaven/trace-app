import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AppError } from '@trace/shared';
import { loadEnv } from '@trace/config';
import { orgStats, platformMetrics, getPrisma, withOrgContext, type OrgStats } from '@trace/db';
import { PROMETHEUS_CONTENT_TYPE, renderPrometheus } from '@trace/domain';
import { CurrentActor, MfaExempt, Public, RequirePermission } from '../../common/decorators';
import type { AuthenticatedActor } from '../../common/auth.guard';

@ApiTags('ops')
@Controller('ops')
export class OpsController {
  @Get('stats')
  @RequirePermission('ops.read')
  @ApiOperation({ summary: 'Operational stats for the active organization.' })
  stats(@CurrentActor() actor: AuthenticatedActor): Promise<OrgStats> {
    return withOrgContext(actor.organizationId!, (db) => orgStats(db, actor.organizationId!));
  }
}

@ApiTags('ops')
@Controller('metrics')
export class MetricsController {
  @Get()
  @Public()
  @MfaExempt()
  @Header('content-type', PROMETHEUS_CONTENT_TYPE)
  @ApiOperation({ summary: 'Prometheus metrics (Bearer METRICS_TOKEN when configured).' })
  async metrics(@Req() req: Request): Promise<string> {
    const token = loadEnv().METRICS_TOKEN;
    if (token) {
      const header = req.headers.authorization ?? '';
      const presented = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (presented !== token) {
        throw AppError.unauthenticated(
          'metrics.unauthorized',
          'A valid metrics token is required.',
        );
      }
    }
    return renderPrometheus(await platformMetrics(getPrisma()));
  }
}
