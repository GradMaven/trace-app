import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '@trace/shared';
import {
  addBomLine,
  archiveProduct,
  computePcf,
  createProduct,
  deleteBomLine,
  getContext,
  latestPcf,
  listPcfRecords,
  listProducts,
  pcfByVersion,
  productDetail,
  updateBomLine,
  updateProduct,
  withOrgContext,
  type PcfRecordView,
  type ProductDetail,
  type ProductSummary,
} from '@trace/db';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';

const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(80).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  functionalUnit: z.string().trim().min(1).max(80),
  referenceAmount: z.number().positive().max(1e12).optional(),
  referenceUnit: z.string().trim().min(1).max(32),
  allocationMethod: z.enum(['none', 'mass', 'economic', 'physical']).optional(),
  allocationFactor: z.number().min(0).max(1).optional(),
  allocationNote: z.string().trim().max(500).optional().nullable(),
});
const productPatchSchema = productSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
});
const bomLineSchema = z.object({
  label: z.string().trim().max(200),
  kind: z.enum(['material', 'energy', 'transport', 'component', 'process', 'packaging']),
  quantity: z.number().min(0).max(1e12),
  unit: z.string().trim().min(1).max(32),
  source: z.enum(['factor', 'supplier', 'sub_product', 'manual']),
  emissionFactorId: z.string().uuid().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  subProductId: z.string().uuid().optional().nullable(),
  manualKgCo2e: z.number().min(0).max(1e12).optional().nullable(),
  dataTier: z.enum(['primary', 'secondary', 'estimated']).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});
const computeSchema = z.object({ reportingPeriod: z.string().trim().max(32).optional() });

@ApiTags('products')
@Controller('products')
export class ProductsController {
  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Products with their latest PCF summary.' })
  list(@CurrentActor() actor: AuthenticatedActor): Promise<ProductSummary[]> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => listProducts(db, org));
  }

  @Post()
  @RequirePermission('product.manage')
  @ApiOperation({ summary: 'Create a product.' })
  create(
    @Body(new ZodPipe(productSchema)) body: z.infer<typeof productSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string }> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      createProduct(db, { organizationId: org, input: body, actorUserId: actor.userId, requestId: this.rid() }),
    );
  }

  @Get(':id')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'A product with its bill of materials and latest PCF.' })
  detail(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ProductDetail> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => productDetail(db, org, id));
  }

  @Patch(':id')
  @RequirePermission('product.manage')
  @HttpCode(204)
  async update(
    @Param('id') id: string,
    @Body(new ZodPipe(productPatchSchema)) body: z.infer<typeof productPatchSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const org = actor.organizationId!;
    await withOrgContext(org, (db) =>
      updateProduct(db, { organizationId: org, id, patch: body, actorUserId: actor.userId, requestId: this.rid() }),
    );
  }

  @Delete(':id')
  @RequirePermission('product.manage')
  @HttpCode(204)
  async archive(@Param('id') id: string, @CurrentActor() actor: AuthenticatedActor): Promise<void> {
    const org = actor.organizationId!;
    await withOrgContext(org, (db) =>
      archiveProduct(db, { organizationId: org, id, actorUserId: actor.userId, requestId: this.rid() }),
    );
  }

  @Post(':id/bom')
  @RequirePermission('product.manage')
  @ApiOperation({ summary: 'Add a bill-of-materials line.' })
  addLine(
    @Param('id') id: string,
    @Body(new ZodPipe(bomLineSchema)) body: z.infer<typeof bomLineSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<{ id: string }> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      addBomLine(db, {
        organizationId: org,
        productId: id,
        input: body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Patch(':id/bom/:lineId')
  @RequirePermission('product.manage')
  @HttpCode(204)
  async updateLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body(new ZodPipe(bomLineSchema)) body: z.infer<typeof bomLineSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const org = actor.organizationId!;
    await withOrgContext(org, (db) =>
      updateBomLine(db, {
        organizationId: org,
        productId: id,
        lineId,
        input: body,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Delete(':id/bom/:lineId')
  @RequirePermission('product.manage')
  @HttpCode(204)
  async removeLine(
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    const org = actor.organizationId!;
    await withOrgContext(org, (db) =>
      deleteBomLine(db, {
        organizationId: org,
        productId: id,
        lineId,
        actorUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Post(':id/pcf/compute')
  @RequirePermission('product.manage')
  @ApiOperation({ summary: 'Compute the product carbon footprint and store a new version.' })
  compute(
    @Param('id') id: string,
    @Body(new ZodPipe(computeSchema)) body: z.infer<typeof computeSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<PcfRecordView> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) =>
      computePcf(db, {
        organizationId: org,
        productId: id,
        reportingPeriod: body.reportingPeriod,
        computedByUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }

  @Get(':id/pcf')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'The latest (or a specific) PCF record for a product.' })
  async pcf(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Query('version') version?: string,
  ): Promise<PcfRecordView> {
    const org = actor.organizationId!;
    const v = version ? Number.parseInt(version, 10) : undefined;
    const rec = await withOrgContext(org, (db) =>
      v && Number.isFinite(v) ? pcfByVersion(db, org, id, v) : latestPcf(db, org, id),
    );
    if (!rec) throw AppError.notFound('pcf.none', 'No PCF has been computed for this product.');
    return rec;
  }

  @Get(':id/pcf/history')
  @RequirePermission('product.read')
  history(
    @Param('id') id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<Awaited<ReturnType<typeof listPcfRecords>>> {
    const org = actor.organizationId!;
    return withOrgContext(org, (db) => listPcfRecords(db, org, id));
  }
}
