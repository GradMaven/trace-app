import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { getContext, recomputeSupplierPassport, withOrgContext } from '@trace/db';
import { AppError, type Page } from '@trace/shared';
import { CurrentActor, RequirePermission } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { AuthenticatedActor } from '../../common/auth.guard';
import { SuppliersService, type SupplierListItem } from './suppliers.service';
import {
  contactInputSchema,
  createSupplierSchema,
  listSuppliersQuerySchema,
  locationInputSchema,
  relationshipInputSchema,
  updateSupplierSchema,
  type ContactInput,
  type CreateSupplierInput,
  type ListSuppliersQuery,
  type LocationInput,
  type RelationshipInput,
  type UpdateSupplierInput,
} from './suppliers.dto';

@ApiTags('suppliers')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  private rid(): string {
    return getContext()?.requestId ?? 'unknown';
  }

  @Get()
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'List suppliers in the active organization.' })
  list(
    @CurrentActor() actor: AuthenticatedActor,
    @Query(new ZodPipe(listSuppliersQuerySchema)) query: ListSuppliersQuery,
  ): Promise<Page<SupplierListItem>> {
    return this.suppliers.list(actor.organizationId!, query);
  }

  @Post()
  @RequirePermission('supplier.create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a supplier (optionally with contacts and a relationship).' })
  create(
    @CurrentActor() actor: AuthenticatedActor,
    @Body(new ZodPipe(createSupplierSchema)) body: CreateSupplierInput,
  ): Promise<{ id: string }> {
    return this.suppliers.create(actor.organizationId!, actor.userId, body, this.rid());
  }

  @Get(':id')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'Supplier detail: profile, relationship, contacts, locations, requests, evidence, latest passport.' })
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<unknown> {
    return this.suppliers.get(actor.organizationId!, id);
  }

  @Patch(':id')
  @RequirePermission('supplier.update')
  @HttpCode(204)
  @ApiOperation({ summary: 'Update supplier profile fields.' })
  async update(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ): Promise<void> {
    await this.suppliers.update(actor.organizationId!, id, actor.userId, body, this.rid());
  }

  @Post(':id/archive')
  @RequirePermission('supplier.archive')
  @HttpCode(204)
  async archive(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<void> {
    await this.suppliers.setArchived(actor.organizationId!, id, actor.userId, true, this.rid());
  }

  @Post(':id/restore')
  @RequirePermission('supplier.archive')
  @HttpCode(204)
  async restore(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string): Promise<void> {
    await this.suppliers.setArchived(actor.organizationId!, id, actor.userId, false, this.rid());
  }

  @Post(':id/relationship')
  @RequirePermission('supplier.update')
  @HttpCode(204)
  @ApiOperation({ summary: 'Create or replace the customer↔supplier relationship record.' })
  async setRelationship(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(relationshipInputSchema)) body: RelationshipInput,
  ): Promise<void> {
    await this.suppliers.upsertRelationship(actor.organizationId!, id, actor.userId, body, this.rid());
  }

  @Post(':id/contacts')
  @RequirePermission('supplier.update')
  @HttpCode(201)
  addContact(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(contactInputSchema)) body: ContactInput,
  ): Promise<{ id: string }> {
    return this.suppliers.addContact(actor.organizationId!, id, actor.userId, body, this.rid());
  }

  @Post(':id/locations')
  @RequirePermission('supplier.update')
  @HttpCode(201)
  addLocation(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodPipe(locationInputSchema)) body: LocationInput,
  ): Promise<{ id: string }> {
    return this.suppliers.addLocation(actor.organizationId!, id, actor.userId, body, this.rid());
  }

  @Get(':id/passport')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'Latest Supplier Passport (versioned snapshot).' })
  async passport(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, async (db) => {
      const p = await db.supplierPassport.findFirst({
        where: { supplierId: id, organizationId: actor.organizationId! },
        orderBy: { version: 'desc' },
      });
      if (!p) throw AppError.notFound('passport.not_found', 'No passport computed yet.');
      return {
        version: p.version,
        builderVersion: p.builderVersion,
        completeness: p.completeness,
        computedAt: p.computedAt.toISOString(),
        data: p.data,
      };
    });
  }

  @Post(':id/evidence-refs/:refId/promote')
  @RequirePermission('evidence.create')
  @HttpCode(201)
  @ApiOperation({ summary: 'Promote a supplier-submitted evidence reference into an Evidence record.' })
  promoteRef(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Param('refId') refId: string,
  ): Promise<{ evidenceId: string }> {
    return this.suppliers.promoteEvidenceRef(
      actor.organizationId!,
      id,
      refId,
      actor.userId,
      this.rid(),
    );
  }

  @Post(':id/passport/recompute')
  @RequirePermission('supplier.update')
  @HttpCode(200)
  @ApiOperation({ summary: 'Recompute the Supplier Passport from current data (new version).' })
  async recompute(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
  ): Promise<unknown> {
    return withOrgContext(actor.organizationId!, (db) =>
      recomputeSupplierPassport(db, {
        organizationId: actor.organizationId!,
        supplierId: id,
        computedByUserId: actor.userId,
        requestId: this.rid(),
      }),
    );
  }
}
