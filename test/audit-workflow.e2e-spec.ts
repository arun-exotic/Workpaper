import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

interface LoginResponseBody {
  accessToken: string;
}

interface DocumentResponseBody {
  status: string;
  reviewComment: string | null;
}

interface AuditEventResponseBody {
  action: string;
}

/**
 * Covers the two things the task brief calls out as most important: the
 * document review workflow producing a complete, ordered audit trail, and
 * a Firm A user being structurally unable to reach Firm B's data (not just
 * a hidden button — a 404 from the backend).
 *
 * Fixtures are created directly against Postgres with a raw PrismaClient
 * (bypassing the app's tenant-scoped client, which requires a request
 * context that doesn't exist yet) and torn down afterwards.
 */
describe('Audit workflow (e2e)', () => {
  let app: INestApplication<App>;
  const rawPrisma = new PrismaClient();

  let firmAId: number;
  let firmBId: number;
  let staffToken: string;
  let reviewerToken: string;
  let otherFirmStaffToken: string;
  let clientId: number;
  let documentId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    const passwordHash = await bcrypt.hash('password123', 10);
    const firmA = await rawPrisma.firm.create({ data: { name: 'E2E Firm A' } });
    const firmB = await rawPrisma.firm.create({ data: { name: 'E2E Firm B' } });
    firmAId = firmA.id;
    firmBId = firmB.id;

    await rawPrisma.user.create({
      data: {
        firmId: firmAId,
        name: 'E2E Staff',
        email: 'e2e-staff@firm-a.test',
        passwordHash,
        role: Role.STAFF,
      },
    });
    await rawPrisma.user.create({
      data: {
        firmId: firmAId,
        name: 'E2E Reviewer',
        email: 'e2e-reviewer@firm-a.test',
        passwordHash,
        role: Role.REVIEWER,
      },
    });
    await rawPrisma.user.create({
      data: {
        firmId: firmBId,
        name: 'E2E Other Firm Staff',
        email: 'e2e-staff@firm-b.test',
        passwordHash,
        role: Role.STAFF,
      },
    });

    staffToken = await loginFor('e2e-staff@firm-a.test');
    reviewerToken = await loginFor('e2e-reviewer@firm-a.test');
    otherFirmStaffToken = await loginFor('e2e-staff@firm-b.test');
  });

  afterAll(async () => {
    await rawPrisma.auditEvent.deleteMany({
      where: { firmId: { in: [firmAId, firmBId] } },
    });
    await rawPrisma.document.deleteMany({
      where: { firmId: { in: [firmAId, firmBId] } },
    });
    await rawPrisma.client.deleteMany({
      where: { firmId: { in: [firmAId, firmBId] } },
    });
    await rawPrisma.user.deleteMany({
      where: { firmId: { in: [firmAId, firmBId] } },
    });
    await rawPrisma.firm.deleteMany({
      where: { id: { in: [firmAId, firmBId] } },
    });
    await rawPrisma.$disconnect();
    await app.close();
  });

  async function loginFor(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' });
    return (res.body as LoginResponseBody).accessToken;
  }

  it('rejects a wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'e2e-staff@firm-a.test', password: 'wrong-password' })
      .expect(401);
  });

  it('forbids a non-ADMIN role from creating a client', async () => {
    await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: 'Should be rejected' })
      .expect(403);
  });

  it('walks the golden path: request doc -> upload -> start review -> correction -> re-upload -> approve', async () => {
    // Create the client directly (no ADMIN user in this fixture set — the
    // create-permission check above already covers that path).
    const client = await rawPrisma.client.create({
      data: { firmId: firmAId, name: 'E2E Client Pvt Ltd' },
    });
    clientId = client.id;

    const createDocRes = await request(app.getHttpServer())
      .post(`/clients/${clientId}/documents`)
      .set('Authorization', `Bearer ${reviewerToken}`) // ADMIN-only in the app, but no ADMIN fixture — expect 403 to confirm the guard, then create directly
      .send({ name: 'Bank Statement' });
    expect(createDocRes.status).toBe(403);

    const document = await rawPrisma.document.create({
      data: {
        firmId: firmAId,
        clientId,
        name: 'Bank Statement',
        status: 'PENDING',
      },
    });
    documentId = document.id;

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/upload`)
      .set('Authorization', `Bearer ${staffToken}`)
      .attach('file', Buffer.from('page 1 and 2 only'), 'bank_statement.pdf')
      .expect(201)
      .expect((res) =>
        expect((res.body as DocumentResponseBody).status).toBe('UPLOADED'),
      );

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/start-review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(201)
      .expect((res) =>
        expect((res.body as DocumentResponseBody).status).toBe('UNDER_REVIEW'),
      );

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        action: 'REQUEST_CORRECTION',
        comment:
          'Page 3 is missing. Please upload the complete bank statement.',
      })
      .expect(201)
      .expect((res) => {
        const body = res.body as DocumentResponseBody;
        expect(body.status).toBe('CORRECTION_REQUIRED');
        expect(body.reviewComment).toContain('Page 3');
      });

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/upload`)
      .set('Authorization', `Bearer ${staffToken}`)
      .attach('file', Buffer.from('all three pages'), 'bank_statement_v2.pdf')
      .expect(201)
      .expect((res) =>
        expect((res.body as DocumentResponseBody).status).toBe('UPLOADED'),
      );

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/start-review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/documents/${documentId}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ action: 'APPROVE' })
      .expect(201)
      .expect((res) => {
        const body = res.body as DocumentResponseBody;
        expect(body.status).toBe('APPROVED');
        expect(body.reviewComment).toBeNull();
      });

    const auditLogRes = await request(app.getHttpServer())
      .get(`/documents/${documentId}/audit-log`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    const actions = (auditLogRes.body as AuditEventResponseBody[]).map(
      (e) => e.action,
    );
    expect(actions).toEqual([
      'DOCUMENT_UPLOADED',
      'REVIEW_STARTED',
      'CORRECTION_REQUESTED',
      'DOCUMENT_UPLOADED',
      'REVIEW_STARTED',
      'DOCUMENT_APPROVED',
    ]);
  });

  it('blocks a re-upload of an already-approved document', async () => {
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/upload`)
      .set('Authorization', `Bearer ${staffToken}`)
      .attach('file', Buffer.from('too late'), 'bank_statement_v3.pdf')
      .expect(400);
  });

  it("does not let Firm B's staff see Firm A's client (404, not 403 — existence is not leaked)", async () => {
    await request(app.getHttpServer())
      .get(`/clients/${clientId}`)
      .set('Authorization', `Bearer ${otherFirmStaffToken}`)
      .expect(404);
  });

  it("does not let Firm B's staff see Firm A's document or its audit trail", async () => {
    await request(app.getHttpServer())
      .get(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${otherFirmStaffToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/documents/${documentId}/audit-log`)
      .set('Authorization', `Bearer ${otherFirmStaffToken}`)
      .expect(404);
  });

  it("does not let Firm B's staff upload against Firm A's document id", async () => {
    await request(app.getHttpServer())
      .post(`/documents/${documentId}/upload`)
      .set('Authorization', `Bearer ${otherFirmStaffToken}`)
      .attach(
        'file',
        Buffer.from('attempted cross-firm write'),
        'malicious.pdf',
      )
      .expect(404);
  });

  it('rejects a request-correction with no comment', async () => {
    const doc = await rawPrisma.document.create({
      data: {
        firmId: firmAId,
        clientId,
        name: 'GST Return',
        status: 'UPLOADED',
      },
    });
    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/start-review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/documents/${doc.id}/review`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ action: 'REQUEST_CORRECTION' })
      .expect(400);
  });
});
