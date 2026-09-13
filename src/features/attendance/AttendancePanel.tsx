import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceSchema, type AttendanceCommand } from '../../contracts/attendance';
import { communityResultSchema } from '../../contracts/community';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { form } from '../account/account.css';
const labels = {
  pending: '현장 확인 대기',
  checked_in: '현장 확인됨',
  no_show_pending: '종료 후 확인 대기',
  attendance_unverified: '확인되지 않음',
  no_show: '별도 검토로 불참 확인',
};
const errors: Record<string, string> = {
  CHECKIN_TIME: '현장 확인 가능한 시간이 아닙니다.',
  STALE_POSITION: '오래된 위치입니다. 다시 위치를 확인해 주세요.',
  INACCURATE_POSITION: '위치 정확도가 부족합니다. 다시 시도하거나 수동 확인을 요청해 주세요.',
  OUTSIDE_PLACE: '약속 장소 근처의 위치가 아닙니다. 수동 확인을 요청할 수 있습니다.',
  REVIEW_TIME: '주최자 확인 기한이 지났습니다.',
  REVIEW_STATE: '현재 처리할 수 있는 요청이 아닙니다.',
  ALREADY_CONFIRMED: '이미 현장 확인되었습니다.',
  NOT_PARTICIPANT: '현재 참여자만 현장 확인할 수 있습니다.',
};
export function AttendancePanel({
  id,
  userId,
  ready,
}: {
  id: string;
  userId: string;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false),
    [pending, setPending] = useState(false),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState(''),
    [unknown, setUnknown] = useState<{ input: AttendanceCommand; key: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const q = useQuery({
    queryKey: ['private', userId, 'attendance', id],
    enabled: open && ready,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) =>
      meetingRequest(`/api/v1/meetups/${id}/attendance`, attendanceSchema, {
        signal,
        headers: { 'X-Cmon-User': userId },
      }),
  });
  async function send(input: AttendanceCommand, key: string = crypto.randomUUID()) {
    if (!ready || pending) return;
    setPending(true);
    setMessage('');
    try {
      await meetingRequest(`/api/v1/meetups/${id}/attendance`, communityResultSchema, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cmon-User': userId,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(input),
      });
      if (!alive.current) return;
      setUnknown(null);
      setMessage(
        input.action === 'requestReview'
          ? '확인 요청을 접수했습니다. 출석 확정은 아직 아닙니다.'
          : '현장 확인 상태를 반영했습니다.',
      );
      await q.refetch();
    } catch (e) {
      if (!alive.current) return;
      if (!(e instanceof MeetingRequestError) || e.status >= 500) setUnknown({ input, key });
      setMessage(
        e instanceof MeetingRequestError
          ? (errors[e.code] ?? e.message)
          : '응답을 확인하지 못했습니다. 저장 결과를 확인해 주세요.',
      );
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const locate = () => {
    if (!navigator.geolocation) {
      setMessage('이 브라우저에서는 위치를 확인할 수 없습니다. 수동 확인을 요청해 주세요.');
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!alive.current) return;
        setPending(false);
        void send({
          action: 'checkIn',
          position: {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            capturedAt: p.timestamp,
          },
        });
      },
      (e) => {
        if (!alive.current) return;
        setPending(false);
        setMessage(
          e.code === 1
            ? '위치 권한이 거부되었습니다. 수동 확인을 요청할 수 있습니다.'
            : '위치를 확인하지 못했습니다. 다시 시도하거나 수동 확인을 요청해 주세요.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };
  const disabled = !ready || pending || !!unknown || q.isFetching || q.isError;
  return (
    <section>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        현장 확인
      </button>
      {open ? (
        <div hidden={!ready}>
          {message ? <p role="status">{message}</p> : null}
          {q.isPending ? <p>현장 확인 상태를 조회하는 중…</p> : null}
          {q.error ? (
            <p role="alert">
              상태를 조회하지 못했습니다.
              <button onClick={() => void q.refetch()}>현장 상태 다시 조회</button>
            </p>
          ) : null}
          {q.data ? (
            <>
              <p>
                {q.data.state.status
                  ? labels[q.data.state.status]
                  : '현재 출석 확인 대상이 아닙니다.'}
              </p>
              <p>위치 확인은 실제 운동 수행을 증명하지 않습니다. 위치 원본은 저장하지 않습니다.</p>
              <p>
                시작 30분 전부터 종료 30분 후까지 장소 반경 200m, 정확도 100m 이내의 최근 위치를
                확인합니다. 개발 정책이며 현장 검증 전입니다.
              </p>
              {q.data.state.review ? (
                <p>
                  수동 요청:{' '}
                  {q.data.state.review === 'pending'
                    ? '주최자 확인 대기'
                    : q.data.state.review === 'approved'
                      ? '승인'
                      : q.data.state.review === 'expired'
                        ? '확인 기한 지남'
                        : '확인 거절'}
                </p>
              ) : null}
              {q.data.state.status &&
              ['pending', 'no_show_pending'].includes(q.data.state.status) ? (
                <>
                  <button disabled={disabled} onClick={locate}>
                    현재 위치로 확인
                  </button>
                  {!q.data.host ? (
                    <form
                      className={form}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void send({ action: 'requestReview', reason });
                      }}
                    >
                      <label>
                        수동 확인 사유
                        <textarea
                          required
                          maxLength={500}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <button disabled={disabled || q.data.state.review === 'pending'}>
                        주최자에게 확인 요청
                      </button>
                      <p>시작 30분 전부터 종료 다음 날까지 요청할 수 있습니다.</p>
                    </form>
                  ) : (
                    <p>주최자는 자신의 수동 출석을 확정할 수 없습니다.</p>
                  )}
                </>
              ) : null}
              {q.data.host ? (
                <section>
                  <h3>참여자의 확인 요청</h3>
                  {q.data.requests.length === 0 ? <p>접수된 요청이 없습니다.</p> : null}
                  {q.data.requests.map((r) => (
                    <div key={r.userId}>
                      <p>
                        {r.name}: {r.reason} ·{' '}
                        {r.review === 'pending'
                          ? '대기'
                          : r.review === 'approved'
                            ? '승인'
                            : r.review === 'expired'
                              ? '기한 지남'
                              : '거절'}
                      </p>
                      {r.review === 'pending' ? (
                        <>
                          <ReviewButton
                            label="현장 참여 확인"
                            disabled={disabled}
                            run={() =>
                              send({ action: 'review', userId: r.userId, decision: 'approved' })
                            }
                          />
                          <ReviewButton
                            label="확인 거절"
                            disabled={disabled}
                            run={() =>
                              send({ action: 'review', userId: r.userId, decision: 'rejected' })
                            }
                          />
                        </>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          ) : null}
          {unknown ? (
            <div role="alert">
              <p>응답 미확인 상태입니다. 같은 요청을 다시 보내도 중복 반영하지 않습니다.</p>
              <button
                disabled={pending}
                onClick={() =>
                  void meetingRequest(
                    '/api/v1/me/attendance-commands/' + unknown.key,
                    communityResultSchema,
                    { headers: { 'X-Cmon-User': userId } },
                  )
                    .then((r) => {
                      if (!alive.current) return;
                      if (r.id) {
                        setUnknown(null);
                        setMessage('저장 결과를 확인했습니다.');
                        void q.refetch();
                      } else
                        setMessage(
                          '아직 결과가 없습니다. 늦게 도착할 수 있으므로 같은 요청 번호를 유지합니다.',
                        );
                    })
                    .catch(() => {
                      if (alive.current) setMessage('결과 조회에 실패했습니다.');
                    })
                }
              >
                현장 요청 결과 확인
              </button>
              <button disabled={pending} onClick={() => void send(unknown.input, unknown.key)}>
                현장 요청 다시 보내기
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
function ReviewButton({
  label,
  disabled,
  run,
}: {
  label: string;
  disabled: boolean;
  run: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span>
      {label}하시겠습니까?{' '}
      <button disabled={disabled} onClick={() => void run().then(() => setConfirm(false))}>
        {label} 확정
      </button>
      <button onClick={() => setConfirm(false)}>닫기</button>
    </span>
  ) : (
    <button disabled={disabled} onClick={() => setConfirm(true)}>
      {label}
    </button>
  );
}
