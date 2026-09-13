import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { meetupKey, staleTime } from '../../contracts/meetup';
import { publicAPI } from '../../api/public';
import { nativeBridge, type BridgeClient } from '../../app/bridge';
import * as css from './meetup.css';
export type Route = { id: string; discussion: boolean };
export { displayDate } from '../../contracts/date';
import { displayDate } from '../../contracts/date';
export function MeetupPage({ route }: { route: Route }) {
  const [ready, setReady] = useState(false);
  const [bridge, setBridge] = useState<BridgeClient | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState('');
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    setReady(true);
    let client = nativeBridge();
    setBridge(client);
    const close = () => client?.close();
    const restore = () => {
      client?.close();
      client = nativeBridge();
      setBridge(client);
    };
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', restore);
    return () => {
      close();
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', restore);
    };
  }, []);
  const query = useQuery({
    queryKey: meetupKey(route.id),
    staleTime,
    retry: false,
    queryFn: ({ signal }) => publicAPI.meetup(route.id, signal),
  });
  const open = async () => {
    if (!bridge) return;
    setOpening(true);
    setBridgeStatus('앱으로 돌아가는 중…');
    try {
      const capabilities = await bridge.request('capabilities');
      const supported =
        capabilities.status === 'ok' &&
        typeof capabilities.result === 'object' &&
        capabilities.result !== null &&
        'openMeetup' in capabilities.result &&
        capabilities.result.openMeetup === true;
      if (!supported) {
        setBridgeStatus('이 앱에서는 복귀 기능을 지원하지 않습니다. 상단 닫기를 이용해 주세요.');
        return;
      }
      const response = await bridge.request('openMeetup', { meetupId: route.id });
      setBridgeStatus(
        response.status === 'ok'
          ? '앱이 복귀 요청을 수락했습니다.'
          : '복귀 요청을 처리하지 못했습니다. 상단 닫기를 이용해 주세요.',
      );
    } catch {
      setBridgeStatus(
        '앱 응답을 확인하지 못했습니다. 이동했을 수 있으니 상단 닫기를 이용해 주세요.',
      );
    } finally {
      setOpening(false);
    }
  };
  const meetup = query.data?.meetup;
  const notFound = query.data === null;
  return (
    <main className={[css.page, css.embeddedPage].join(' ')}>
      <header>
        <p>C'mon Yo!</p>
        <p className={css.note}>공개 샘플 모임 · 실제 모집이 아닙니다.</p>
      </header>
      {query.isError ? (
        <p role="alert">{query.error.message}</p>
      ) : notFound ? (
        <p role="alert">모임을 찾을 수 없습니다.</p>
      ) : null}
      {meetup && query.isError ? (
        <p>이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.</p>
      ) : null}
      {meetup ? (
        <>
          <h1>
            {meetup.title}
            {route.discussion ? ' · 모임 안내' : ''}
          </h1>
          <dl>
            <dt>일시 · 한국 시간</dt>
            <dd>
              <time dateTime={meetup.startsAt}>{displayDate(meetup.startsAt)}</time> –{' '}
              <time dateTime={meetup.endsAt}>{displayDate(meetup.endsAt)}</time>
            </dd>
            <dt>장소</dt>
            <dd>{meetup.place.name}</dd>
            <dt>종목</dt>
            <dd>
              {{ walking: '걷기', running: '달리기', cycling: '자전거' }[meetup.sport] ??
                '알 수 없는 종목'}
            </dd>
            <dt>정원</dt>
            <dd>{meetup.capacity}명</dd>
          </dl>
          <p>{meetup.description ?? '등록된 설명이 없습니다.'}</p>
          {route.discussion ? (
            <p>읽기 전용 연결 시험입니다. 댓글 작성과 저장은 제공하지 않습니다.</p>
          ) : null}
        </>
      ) : (
        <h1>모임 상세</h1>
      )}
      <p role="status" aria-live="polite">
        {query.isFetching ? '모임을 불러오는 중…' : ''}
      </p>
      <div className={css.actions}>
        <button disabled={!ready || query.isFetching} onClick={() => void query.refetch()}>
          {query.isError || notFound ? '다시 시도' : '모임 새로고침'}
        </button>
        {!route.discussion && meetup ? (
          <a href={`/meetups/${route.id}/discussion`}>읽기 전용 모임 안내</a>
        ) : null}
        {route.discussion ? (
          bridge ? (
            <button disabled={opening} onClick={() => void open()}>
              앱 모임으로 돌아가기
            </button>
          ) : (
            <a href={`/meetups/${route.id}`}>모임 상세로 돌아가기</a>
          )
        ) : null}
      </div>
      <p role="status" aria-live="polite">
        {bridgeStatus}
      </p>
    </main>
  );
}
