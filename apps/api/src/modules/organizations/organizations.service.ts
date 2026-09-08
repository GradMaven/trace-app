import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '@trace/shared';
import { getPrisma, provisionOrganization, withOrgContext } from '@trace/db';
import type { CreateOrganizationInput } from './organizations.dto';

export interface OrganizationView {
  id: string;
  slug: string;
  legalName: string;
  country: string;
  baseCurrency: string;
  status: string;
  createdAt: string;
}

@Injectable()
export class OrganizationsService {
  async create(
    input: CreateOrganizationInput,
    creatorUserId: string,
    requestId: string,
  ): Promise<OrganizationView> {
    const prisma = getPrisma();
    const slug = input.slug ?? slugify(input.legalName);

    const clash = await prisma.organization.findUnique({ where: { slug } });
    if (clash) {
      throw AppError.conflict('organization.slug_taken', `The identifier "${slug}" is already in use.`);
    }

    const organizationId = randomUUID();
    await withOrgContext(organizationId, (db) =>
      provisionOrganization(db, {
        organizationId,
        slug,
        legalName: input.legalName,
        country: input.country,
        baseCurrency: input.baseCurrency,
        creatorUserId,
        requestId,
      }),
    );

    // Make the new organization the active one for this session.
    await prisma.session.updateMany({
      where: { userId: creatorUserId, revokedAt: null },
      data: { organizationId },
    });

    return this.getByIdOrThrow(organizationId);
  }

  async getByIdOrThrow(id: string): Promise<OrganizationView> {
    const org = await getPrisma().organization.findUnique({ where: { id } });
    if (!org) throw AppError.notFound('organization.not_found', 'Organization not found.');
    return {
      id: org.id,
      slug: org.slug,
      legalName: org.legalName,
      country: org.country,
      baseCurrency: org.baseCurrency,
      status: org.status,
      createdAt: org.createdAt.toISOString(),
    };
  }
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomUUID().slice(0, 6);
  return base ? `${base}-${suffix}` : `org-${suffix}`;
}
