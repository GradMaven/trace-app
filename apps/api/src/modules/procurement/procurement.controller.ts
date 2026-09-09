import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  getContext,
  listProcurementScenarios,
  procurementScenarioById,
  runProcurementScenario,
  scenarioLinesForSuppliers,
  supplierCarbonComparison,
  withOrgContext,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const periodQuery = z.object({ reportingPeriod: z.string().max(60).optional() });

const linesSchema = z.object({
  supplierIds: z.array(z.string().uuid()).min(1).max(40),
  reportingPeriod: z.string().max(60).optional(),
});

const lineSchema = z.object({
  supplierId: z.string().uuid(),
  supplierName: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  activityValue: z.number().finite().nonnegative(),
  activityUnit: z.string().min(1).max(40),
  factorValue: z.number().finite().nonnegative(),
  factorNumeratorUnit: z.string().min(1).max(20),
  factorDenominatorUnit: z.string().min(1).max(40),
  gwpSet: z.string().min(1).max(20),
  methodology: z.string().min(1).max(40),
});

const changeSchema = z.object({
  supplierId: z.string().uuid(),
  activityMultiplier: z.number().finite().min(0).max(100).optional(),
  factorValue: z.number().finite().nonnegative().optional(),
  methodology: z.string().min(1).max(40).optional(),
  drop: z.boolean().optional(),
});

const scenarioSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  reportingPeriod: z.string().max(60).optional(),
  lines: z.array(lineSchema).min(1).max(40),
  changes: z.array(changeSchema).max(40).default([]),
});

@ApiTags('procurement')
@Controller('procurement')
export class ProcurementController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get('suppliers')
  @RequirePermission('supplier.read')
  @ApiOperation({
    summary: 'Suppliers ranked by carbon intensity, with shares and reduction opportunities.',
  })
  suppliers(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(periodQuery)) query: z.infer<typeof periodQuery>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      supplierCarbonComparison(db, actor.organizationId!, query.reportingPeriod),
    );
  }

  @Post('scenarios/lines')
  @RequirePermission('supplier.read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Build default what-if lines from the selected suppliers’ current calculations.',
  })
  lines(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(linesSchema)) body: z.infer<typeof linesSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      scenarioLinesForSuppliers(db, actor.organizationId!, body.supplierIds, body.reportingPeriod),
    );
  }

  @Post('scenarios')
  @RequirePermission('procurement.scenario')
  @HttpCode(201)
  @ApiOperation({ summary: 'Run and save a procurement carbon what-if scenario.' })
  runScenario(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(scenarioSchema)) body: z.infer<typeof scenarioSchema>,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      runProcurementScenario(db, {
        organizationId: actor.organizationId!,
        name: body.name,
        description: body.description,
        reportingPeriod: body.reportingPeriod,
        lines: body.lines,
        changes: body.changes,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get('scenarios')
  @RequirePermission('supplier.read')
  scenarios(@CurrentActor() actor: AuthenticatedActor): Promise<unknown[]> {
    return withOrgContext(actor.organizationId!, (db) =>
      listProcurementScenarios(db, actor.organizationId!),
    );
  }

  @Get('scenarios/:id')
  @RequirePermission('supplier.read')
  scenario(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      procurementScenarioById(db, actor.organizationId!, id),
    );
  }
}
