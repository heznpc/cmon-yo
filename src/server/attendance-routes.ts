import type { FastifyInstance } from 'fastify';
import { attendanceCommandSchema } from '../contracts/attendance';
import { idSchema } from '../contracts/meetup';
import { currentAccount } from './auth/routes';
import type { AuthService } from './auth/service';
import type { AttendanceService } from './services/attendance';
import { ServiceError } from './services/meetup';
export function registerAttendance(
  app: FastifyInstance,
  service: AttendanceService,
  auth?: AuthService,
) {
  for (const [method, url] of [
    ['GET', '/api/v1/meetups/:id/attendance'],
    ['POST', '/api/v1/meetups/:id/attendance'],
    ['GET', '/api/v1/me/attendance-commands/:id'],
  ] as const) {
    app.route({
      method,
      url,
      bodyLimit: 8192,
      handler: async (r, p) => {
        try {
          const id = idSchema.safeParse((r.params as { id: string }).id);
          if (!id.success) throw new ServiceError(400, 'INVALID_ID', '주소를 확인해 주세요.');
          if (
            method === 'POST' &&
            (r.headers.cookie || !r.headers.authorization) &&
            r.headers.origin !== auth?.options.baseURL
          )
            throw new ServiceError(403, 'INVALID_ORIGIN', '허용되지 않은 요청입니다.');
          const user = auth ? (await currentAccount(auth, r, p)).user : null;
          if (!user) throw new ServiceError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
          if (!user.emailVerified)
            throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', '이메일 인증이 필요합니다.');
          if (
            method === 'GET' &&
            r.headers['x-cmon-user'] !== undefined &&
            r.headers['x-cmon-user'] !== user.id
          )
            throw new ServiceError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다.');
          if (method === 'GET')
            return url.includes('/me/')
              ? service.result(user.id, id.data)
              : service.detail(user.id, id.data);
          if (r.headers['x-cmon-user'] !== user.id)
            throw new ServiceError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다.');
          const input = attendanceCommandSchema.safeParse(r.body),
            key = idSchema.safeParse(r.headers['idempotency-key']);
          if (!input.success || !key.success)
            throw new ServiceError(400, 'INVALID_INPUT', '입력을 확인해 주세요.');
          return await service.command(user.id, key.data, id.data, input.data);
        } catch (e) {
          const err =
            e instanceof ServiceError
              ? e
              : new ServiceError(503, 'UNAVAILABLE', '현장 확인 결과를 조회하지 못했습니다.');
          return p.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              requestId: r.id,
              retryable: err.status >= 500,
            },
          });
        }
      },
    });
  }
}
