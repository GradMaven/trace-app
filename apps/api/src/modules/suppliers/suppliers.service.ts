import { Injectable } from '@nestjs/common';
import { AppError, page, type Page } from '@trace/shared';
import { withOrgContext, writeAuditLog, type TenantDb } from '@trace/db';
import type {
  ContactInput,
  CreateSupplierInput,
  ListSuppliersQuery,
  LocationInput,
  RelationshipInput,
  UpdateSupplierInput,
} from './suppliers.dto';

export interface SupplierListItem {
  id: string;
  name: string;
  country: string;
  industryNace: string | null;
  status: string;
  category: string | null;
  tier: number | null;
  annualSpend: string | null;
  currency: string | null;
  passportCompleteness: number | null;
  openRequests: number;
  createdAt: string;
}

@Injectable()
export class SuppliersService {
  async list(organizationId: string, query: ListSuppliersQuery): Promise<Page<SupplierListItem>> {
    return withOrgContext(organizationId, async (db) => {
      const rows = await db.supplier.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(query.status ? { status: query.status } : {}),
          ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        },
        include: {
          relationship: true,
          passports: { orderBy: { version: 'desc' }, take: 1, select: { completeness: true } },
          _count: { select: { requests: { where: { status: { in: ['sent', 'in_progress'] } } } } },
        },
        orderBy: { name: 'asc' },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((s) => ({
        id: s.id,
        name: s.name,
        country: s.country,
        industryNace: s.industryNace,
        status: s.status,
        category: s.relationship?.category ?? null,
        tier: s.relationship?.tier ?? null,
        annualSpend: s.relationship?.annualSpend?.toString() ?? null,
        currency: s.relationship?.currency ?? null,
        passportCompleteness: s.passports[0]?.completeness ?? null,
        openRequests: s._count.requests,
        createdAt: s.createdAt.toISOString(),
      }));

      return page(items, hasMore ? items[items.length - 1]!.id : undefined);
    });
  }

  async get(organizationId: string, supplierId: string): Promise<unknown> {
    return withOrgContext(organizationId, async (db) => {
      const s = await this.loadOrThrow(db, organizationId, supplierId);
      const [contacts, locations, requests, evidence, passport] = await Promise.all([
        db.supplierContact.findMany({ where: { supplierId }, orderBy: { createdAt: 'asc' } }),
        db.supplierLocation.findMany({ where: { supplierId }, orderBy: { createdAt: 'asc' } }),
        db.supplierRequest.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' } }),
        db.supplierEvidenceRef.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' } }),
        db.supplierPassport.findFirst({ where: { supplierId }, orderBy: { version: 'desc' } }),
      ]);

      return {
        id: s.id,
        name: s.name,
        country: s.country,
        industryNace: s.industryNace,
        registrationIds: s.registrationIds,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        relationship: s.relationship
          ? {
              category: s.relationship.category,
              tier: s.relationship.tier,
              annualSpend: s.relationship.annualSpend?.toString() ?? null,
              currency: s.relationship.currency,
              since: s.relationship.since?.toISOString().slice(0, 10) ?? null,
            }
          : null,
        contacts: contacts.map((c) => ({
          id: c.id,
          email: c.email,
          name: c.name,
          role: c.role,
          isPrimary: c.isPrimary,
        })),
        locations: locations.map((l) => ({
          id: l.id,
          kind: l.kind,
          label: l.label,
          country: l.country,
          address: l.address,
        })),
        requests: requests.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          status: r.status,
          dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
          sentAt: r.sentAt?.toISOString() ?? null,
          submittedAt: r.submittedAt?.toISOString() ?? null,
        })),
        evidence: evidence.map((e) => ({
          id: e.id,
          type: e.type,
          title: e.title,
          sourceUrl: e.sourceUrl,
          reportingPeriod: e.reportingPeriod,
          verified: e.verified,
          createdAt: e.createdAt.toISOString(),
        })),
        passport: passport
          ? {
              version: passport.version,
              completeness: passport.completeness,
              computedAt: passport.computedAt.toISOString(),
              data: passport.data,
            }
          : null,
      };
    });
  }

  async create(
    organizationId: string,
    actorUserId: string,
    input: CreateSupplierInput,
    requestId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      const supplier = await db.supplier.create({
        data: {
          organizationId,
          name: input.name,
          country: input.country,
          industryNace: input.industryNace ?? null,
          registrationIds: input.registrationIds ?? {},
          createdByUserId: actorUserId,
          contacts: input.contacts
            ? {
                create: dedupePrimary(input.contacts).map((c) => ({
                  organizationId,
                  email: c.email,
                  name: c.name,
                  role: c.role ?? null,
                  isPrimary: c.isPrimary ?? false,
                })),
              }
            : undefined,
          relationship: input.relationship
            ? { create: this.relationshipData(organizationId, input.relationship) }
            : undefined,
        },
      });

      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.created',
        resourceType: 'supplier',
        resourceId: supplier.id,
        before: null,
        after: { name: input.name, country: input.country },
        requestId,
      });

      return { id: supplier.id };
    });
  }

  async update(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: UpdateSupplierInput,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const before = await this.loadOrThrow(db, organizationId, supplierId);
      await db.supplier.update({
        where: { id: supplierId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.country !== undefined ? { country: input.country } : {}),
          ...(input.industryNace !== undefined ? { industryNace: input.industryNace } : {}),
          ...(input.registrationIds !== undefined ? { registrationIds: input.registrationIds } : {}),
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.updated',
        resourceType: 'supplier',
        resourceId: supplierId,
        before: { name: before.name, country: before.country, industryNace: before.industryNace },
        after: input,
        requestId,
      });
    });
  }

  async setArchived(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    archived: boolean,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      const s = await this.loadOrThrow(db, organizationId, supplierId);
      await db.supplier.update({
        where: { id: supplierId },
        data: { status: archived ? 'archived' : 'active' },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: archived ? 'supplier.archived' : 'supplier.restored',
        resourceType: 'supplier',
        resourceId: supplierId,
        before: { status: s.status },
        after: { status: archived ? 'archived' : 'active' },
        requestId,
      });
    });
  }

  async upsertRelationship(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: RelationshipInput,
    requestId: string,
  ): Promise<void> {
    await withOrgContext(organizationId, async (db) => {
      await this.loadOrThrow(db, organizationId, supplierId);
      const data = this.relationshipData(organizationId, input);
      await db.supplierRelationship.upsert({
        where: { supplierId },
        create: { supplierId, ...data },
        update: data,
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.relationship_set',
        resourceType: 'supplier',
        resourceId: supplierId,
        before: null,
        after: input,
        requestId,
      });
    });
  }

  async addContact(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: ContactInput,
    requestId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      await this.loadOrThrow(db, organizationId, supplierId);
      const existing = await db.supplierContact.findUnique({
        where: { supplierId_email: { supplierId, email: input.email } },
      });
      if (existing) throw AppError.conflict('supplier.contact_exists', 'That contact already exists.');
      if (input.isPrimary) {
        await db.supplierContact.updateMany({ where: { supplierId }, data: { isPrimary: false } });
      }
      const c = await db.supplierContact.create({
        data: {
          organizationId,
          supplierId,
          email: input.email,
          name: input.name,
          role: input.role ?? null,
          isPrimary: input.isPrimary ?? false,
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.contact_added',
        resourceType: 'supplier_contact',
        resourceId: c.id,
        before: null,
        after: { supplierId, email: input.email },
        requestId,
      });
      return { id: c.id };
    });
  }

  async addLocation(
    organizationId: string,
    supplierId: string,
    actorUserId: string,
    input: LocationInput,
    requestId: string,
  ): Promise<{ id: string }> {
    return withOrgContext(organizationId, async (db) => {
      await this.loadOrThrow(db, organizationId, supplierId);
      const l = await db.supplierLocation.create({
        data: {
          organizationId,
          supplierId,
          kind: input.kind,
          label: input.label,
          country: input.country,
          address: input.address ?? {},
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
        },
      });
      await writeAuditLog(db, {
        organizationId,
        actorId: actorUserId,
        action: 'supplier.location_added',
        resourceType: 'supplier_location',
        resourceId: l.id,
        before: null,
        after: { supplierId, label: input.label },
        requestId,
      });
      return { id: l.id };
    });
  }

  private relationshipData(organizationId: string, input: RelationshipInput) {
    return {
      organizationId,
      category: input.category ?? null,
      tier: input.tier ?? null,
      annualSpend: input.annualSpend ?? null,
      currency: input.currency ?? 'EUR',
      since: input.since ? new Date(input.since) : null,
    };
  }

  private async loadOrThrow(db: TenantDb, organizationId: string, supplierId: string) {
    const s = await db.supplier.findFirst({
      where: { id: supplierId, organizationId, deletedAt: null },
      include: { relationship: true },
    });
    if (!s) throw AppError.notFound('supplier.not_found', 'Supplier not found.');
    return s;
  }
}

function dedupePrimary(contacts: ContactInput[]): ContactInput[] {
  let primarySeen = false;
  return contacts.map((c) => {
    if (c.isPrimary && !primarySeen) {
      primarySeen = true;
      return c;
    }
    return { ...c, isPrimary: false };
  });
}
