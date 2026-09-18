/**
 * Seeds two firms with one user per role each, plus a sample client and its
 * required documents — enough to demonstrate the full workflow and the
 * cross-firm isolation story out of the box.
 *
 * Uses a plain, unextended PrismaClient: the tenant-scoping extension lives
 * in src/prisma/tenant.extension.ts and reads RequestContext, which only
 * exists inside an HTTP request. A seed script has no request, and needs to
 * write explicit, differing firmIds anyway, so it talks to Postgres
 * directly rather than going through the app's scoped client.
 */
import { PrismaClient, Role, DocumentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const REQUIRED_DOCUMENTS = [
  'Bank Statement',
  'Sales Register',
  'Purchase Register',
  'GST Return',
  'Expense Summary',
];

async function seedFirm(
  firmName: string,
  clientName: string,
  staffName: string,
  reviewerName: string,
  adminName: string,
) {
  const firm = await prisma.firm.create({ data: { name: firmName } });
  const passwordHash = await bcrypt.hash('password123', 10);

  const [staff, reviewer, admin] = await Promise.all([
    prisma.user.create({
      data: {
        firmId: firm.id,
        name: staffName,
        email: emailFor(staffName, firmName),
        passwordHash,
        role: Role.STAFF,
      },
    }),
    prisma.user.create({
      data: {
        firmId: firm.id,
        name: reviewerName,
        email: emailFor(reviewerName, firmName),
        passwordHash,
        role: Role.REVIEWER,
      },
    }),
    prisma.user.create({
      data: {
        firmId: firm.id,
        name: adminName,
        email: emailFor(adminName, firmName),
        passwordHash,
        role: Role.ADMIN,
      },
    }),
  ]);

  const client = await prisma.client.create({
    data: { firmId: firm.id, name: clientName },
  });
  await prisma.auditEvent.create({
    data: {
      firmId: firm.id,
      clientId: client.id,
      actorId: admin.id,
      action: 'CLIENT_CREATED',
    },
  });

  for (const name of REQUIRED_DOCUMENTS) {
    const document = await prisma.document.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        name,
        status: DocumentStatus.PENDING,
      },
    });
    await prisma.auditEvent.create({
      data: {
        firmId: firm.id,
        clientId: client.id,
        documentId: document.id,
        actorId: admin.id,
        action: 'DOCUMENT_REQUESTED',
        comment: `Requested "${name}"`,
      },
    });
  }

  return { firm, staff, reviewer, admin, client };
}

function emailFor(name: string, firmName: string) {
  const firmSlug = firmName.split(' ')[0].toLowerCase();
  return `${name.toLowerCase()}@${firmSlug}.test`;
}

async function main() {
  const firmA = await seedFirm(
    'ABC & Co.',
    'ABC Traders Pvt. Ltd.',
    'Rohit',
    'Aman',
    'Priya',
  );
  const firmB = await seedFirm(
    'XYZ & Co.',
    'XYZ Traders Pvt. Ltd.',
    'Sanjay',
    'Meera',
    'Kavita',
  );

  console.log('Seeded two firms. Sample logins (password: password123):\n');
  for (const { firm, staff, reviewer, admin } of [firmA, firmB]) {
    console.log(`${firm.name}:`);
    console.log(`  STAFF    ${staff.email}`);
    console.log(`  REVIEWER ${reviewer.email}`);
    console.log(`  ADMIN    ${admin.email}\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
