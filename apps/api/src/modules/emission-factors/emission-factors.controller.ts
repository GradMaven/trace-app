import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  GHG_CATEGORY,
  GHG_SCOPE,
  METHODOLOGY,
} from '@trace/shared';
import { AppError } from '@trace/shared';
import { getContext, getPrisma, withOrgContext, writeAuditLog } from '@trace/db';
import { listUnits, unitDimension } from '@trace/domain';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const CO2E_UNITS = ['gCO2e', 'kgCO2e', 'tCO2e', 'ktCO2e'] as const;

const createFactorSchema = z.object({
  source: z.string().min(1).max(80),
  sourceRef: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  value: z.number().positive(),
  numeratorUnit: z.enum(CO2E_UNITS),
  denominatorUnit: z.string().min(1).max(40),
  gwpSet: z.string().max(20).default('AR6'),
  scope: z.enum(GHG_SCOPE as unknown as [string, ...string[]]),
  ghgCategory: z.enum(GHG_CATEGORY as unknown as [string, ...string[]]).nullish(),
  geography: z.string().max(12).nullish(),
  methodology: z.enum(METHODOLOGY as unknown as [string, ...string[]]).nullish(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  notes: z.string().max(2000).optional(),
});

const listQuerySchema = z.object({
  scope: z.enum(GHG_SCOPE as unknown as [string, ...string[]]).optional(),
  scopeSet: z.enum(['library', 'organization', 'all']).default('all'),
});

@ApiTags('emission-factors')
@Controller('emission-factors')
export class EmissionFactorsController {
  @Get('units')
  @RequirePermission('calculation.read')
  @ApiOperation({ summary: 'The unit registry (code, dimension, label) for activity data entry.' })
  units(): unknown[] {
    return listUnits().map((u) => ({ code: u.code, dimension: u.dimension, label: u.label ?? u.code }));
  }

  @Get()
  @RequirePermission('calculation.read')
  @ApiOperation({ summary: 'List emission factors (shared library + this organization).' })
  async list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ): Promise<unknown[]> {
    const prisma = getPrisma();
    const orgFilter =
      query.scopeSet === 'library'
        ? { organizationId: null }
        : query.scopeSet === 'organization'
          ? { organizationId: actor.organizationId! }
          : { OR: [{ organizationId: null }, { organizationId: actor.organizationId! }] };
    const rows = await prisma.emissionFactor.findMany({
      where: { ...orgFilter, ...(query.scope ? { scope: query.scope as never } : {}) },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
    return rows.map((f) => ({
      id: f.id,
      scopeSet: f.organizationId ? 'organization' : 'library',
      source: f.source,
      sourceRef: f.sourceRef,
      name: f.name,
      value: f.value.toString(),
      unit: `${f.numeratorUnit}/${f.denominatorUnit}`,
      numeratorUnit: f.numeratorUnit,
      denominatorUnit: f.denominatorUnit,
      dimension: safeDimension(f.denominatorUnit),
      gwpSet: f.gwpSet,
      scope: f.scope,
      ghgCategory: f.ghgCategory,
      geography: f.geography,
      methodology: f.methodology,
      version: f.version,
      validFrom: f.validFrom.toISOString().slice(0, 10),
      validTo: f.validTo?.toISOString().slice(0, 10) ?? null,
      notes: f.notes,
    }));
  }

  @Post()
  @RequirePermission('emission_factor.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create an organization-specific emission factor.' })
  async create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createFactorSchema)) body: z.infer<typeof createFactorSchema>,
  ): Promise<{ id: string }> {
    const dimension = safeDimension(body.denominatorUnit);
    if (!dimension) {
      throw AppError.unprocessable(
        'emission_factor.unknown_unit',
        `Unknown denominator unit: "${body.denominatorUnit}".`,
      );
    }
    const requestId = getContext()?.requestId ?? 'unknown';
    return withOrgContext(actor.organizationId!, async (db) => {
      const factor = await db.emissionFactor.create({
        data: {
          organizationId: actor.organizationId!,
          source: body.source,
          sourceRef: body.sourceRef,
          name: body.name,
          value: body.value,
          numeratorUnit: body.numeratorUnit as never,
          denominatorUnit: body.denominatorUnit,
          activityDimension: dimension,
          gwpSet: body.gwpSet,
          scope: body.scope as never,
          ghgCategory: (body.ghgCategory as never) ?? null,
          geography: body.geography ?? null,
          methodology: (body.methodology as never) ?? null,
          validFrom: new Date(body.validFrom),
          validTo: body.validTo ? new Date(body.validTo) : null,
          notes: body.notes ?? null,
          createdByUserId: actor.userId,
        },
      });
      await writeAuditLog(db, {
        organizationId: actor.organizationId!,
        actorId: actor.userId,
        action: 'emission_factor.created',
        resourceType: 'emission_factor',
        resourceId: factor.id,
        before: null,
        after: { source: body.source, sourceRef: body.sourceRef, scope: body.scope },
        requestId,
      });
      return { id: factor.id };
    });
  }
}

function safeDimension(unit: string): string | null {
  try {
    return unitDimension(unit);
  } catch {
    return null;
  }
}
