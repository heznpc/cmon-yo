import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, RequestError } from '../../api/http';
import { accountKey, accountSchema } from '../../contracts/account';
import { walkingDashboardSchema, walkingKey, walkingPolicy } from '../../contracts/walking';
import { ProductNav } from '../../app/ProductNav';
import { DailyWalking, koreaTime } from './DailyWalking';
import { ExpeditionCard } from './ExpeditionCard';
import { ExpeditionForms } from './ExpeditionForms';
import { Rewards } from './Rewards';
import { useWalkingCommand } from './useWalkingCommand';
import * as styles from '../meetup/meetup.css';
import * as css from './walking.css';

export type QuestsRoute = { section: 'quests'; userId: string | null };

export function QuestsPage({ route, ready = true }: { route: QuestsRoute; ready?: boolean }) {
  const { userId } = route;
  const location = useLocation();
  const embedded = new URLSearchParams(location.search).get('surface') === 'native';
  const account = useQuery({
    queryKey: accountKey(userId),
    queryFn: async ({ signal }) => {
      const value = await apiRequest('/api/v1/me', accountSchema, {
        signal,
        headers: { 'X-Cmon-User': userId! },
      });
      if (value.user?.id !== userId)
        throw new RequestError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다. 화면을 새로 열어 주세요.');
      return value;
    },
    enabled: ready && !!userId,
    retry: false,
    staleTime: 30000,
  });
  const query = useQuery({
    queryKey: walkingKey(userId),
    queryFn: async ({ signal }) => {
      const value = await apiRequest('/api/v1/me/walking', walkingDashboardSchema, {
        signal,
        headers: { 'X-Cmon-User': userId! },
      });
      if (value.userId !== userId)
        throw new RequestError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다. 화면을 새로 열어 주세요.');
      return value;
    },
    enabled: ready && !!userId,
    retry: false,
    staleTime: 30000,
  });
  const verified = account.data?.user?.emailVerified === true && !account.isError;
  const identityError = [account.error, query.error].some(
    (error) => error instanceof RequestError && ['ACCOUNT_CHANGED', 'UNAUTHENTICATED'].includes(error.code),
  );
  const commandReady = ready && verified && !account.isFetching && !identityError;
  const command = useWalkingCommand(userId, commandReady);
  const disabled = !commandReady || command.pending || !!command.unknown || query.isFetching || query.isError;
  const data = query.isError || !verified || identityError ? undefined : query.data;
  const ongoing = data?.expeditions.filter((expedition) => expedition.state === 'recruiting' || expedition.state === 'active') ?? [];
  const history = data?.expeditions.filter((expedition) => expedition.state === 'ended' || expedition.state === 'withdrawn') ?? [];
  const lastSync = data?.days.reduce<string | null>((latest, day) => !latest || day.updatedAt > latest ? day.updatedAt : latest, null);
  return (
    <>
      {!embedded ? <ProductNav /> : null}
      <main id="page-content" tabIndex={-1} className={[styles.page, embedded ? styles.embeddedPage : ''].join(' ')}>
        <h1>걷기 퀘스트</h1>
        <p className={styles.lead}>내 걸음을 모으고, 동료와 7일 원정을 함께 걸어요.</p>
        {!ready ? (
          <p role="status">
            계정을 확인하는 중입니다.{' '}
            <button onClick={() => window.dispatchEvent(new Event('focus'))}>계정 다시 확인</button>
          </p>
        ) : null}
        <div hidden={!ready}>
          {!userId ? (
            <section className={css.panel}>
              <h2>걸음과 포인트를 내 계정에 모으세요</h2>
              <p>이메일 인증을 마친 계정으로 이용할 수 있습니다. 걸음은 iOS 앱에서 건강 앱을 연결해 가져옵니다.</p>
              {embedded ? <p>앱에서 다시 로그인한 뒤 퀘스트를 열어 주세요.</p> : (
                <Link className={styles.primary} to={'/account?returnTo=' + encodeURIComponent(location.pathname + location.search)}>
                  로그인하고 퀘스트 시작하기
                </Link>
              )}
            </section>
          ) : (
            <>
              {account.isPending ? <p role="status">계정 정보를 불러오는 중…</p> : null}
              {account.error ? (
                <p role="alert">
                  {account.error instanceof RequestError ? account.error.message : '계정 정보를 확인하지 못했습니다.'}{' '}
                  <button disabled={account.isFetching} onClick={() => void account.refetch()}>계정 다시 조회</button>
                </p>
              ) : account.data && !verified ? (
                <p role="alert">퀘스트에 참여하려면 이메일 인증을 마쳐 주세요. <Link target={embedded ? '_blank' : undefined} rel={embedded ? 'noreferrer' : undefined} to="/account">내 계정 확인</Link></p>
              ) : null}
              {identityError ? (
                <p role="alert"><button onClick={() => window.location.reload()}>현재 계정으로 화면 다시 열기</button></p>
              ) : null}
              <p role="status">{command.pending ? '요청을 확인하는 중…' : command.notice}</p>
              {command.unknown ? (
                <div role="alert">
                  <p>응답이 끊긴 요청이 있습니다. 다른 보상이나 원정 요청을 보내기 전에 결과를 확인해 주세요.</p>
                  <div className={styles.actions}>
                    <button disabled={command.pending || !commandReady} onClick={() => void command.inspect()}>저장 결과 확인</button>
                    <button disabled={command.pending || !commandReady} onClick={() => void command.retry()}>같은 요청 다시 보내기</button>
                  </div>
                  <p>페이지를 다시 열어도 요청 번호가 유지됩니다. 같은 요청을 다시 보내도 보상을 중복 지급하지 않습니다.</p>
                </div>
              ) : null}
              <div className={styles.actions}>
                <button disabled={query.isFetching || command.pending} onClick={() => void query.refetch()}>걸음·보상 새로고침</button>
              </div>
              {query.isFetching ? <p role="status">걸음과 원정을 불러오는 중…</p> : null}
              {query.error ? (
                <p role="alert">
                  {query.error instanceof RequestError ? query.error.message : '걸음과 보상을 불러오지 못했습니다. 연결을 확인하고 다시 조회해 주세요.'}
                  <button disabled={query.isFetching} onClick={() => void query.refetch()}>퀘스트 다시 조회</button>
                </p>
              ) : null}
              {data ? (
                <div className={css.board}>
                  <section className={css.panel} aria-labelledby="health-title">
                    <h2 id="health-title">건강 앱 걸음 연결</h2>
                    <p>{data.sourceId ? 'iOS 앱에서 건강 앱 연결을 등록했습니다.' : '아직 건강 앱을 연결하지 않았습니다.'}</p>
                    <p>{embedded ? '앱의 걷기 탭에서' : 'iOS 앱의 걷기 탭에서'} HealthKit 걸음 읽기를 허용한 뒤 동기화해 주세요. 이 화면의 새로고침은 서버에 도착한 기록을 가져옵니다.</p>
                    {lastSync ? (
                      <p>마지막 동기화 <time dateTime={lastSync}>{koreaTime(lastSync)}</time> · 한국 시간</p>
                    ) : <p>최근 8일에 동기화된 걸음 기록이 없습니다.</p>}
                    <p className={styles.note}>걸음이 비어 있으면 iOS 건강 앱 권한과 동기화 상태를 확인해 주세요. 이 화면에서는 건강 앱 권한을 바꾸지 않습니다.</p>
                  </section>
                  <DailyWalking data={data} disabled={disabled} mutate={command.run} />
                  <section aria-labelledby="expeditions-title">
                    <h2 id="expeditions-title">함께 걷는 원정</h2>
                    <p>
                      최대 {walkingPolicy.maxMembers}명이 함께합니다. 새 원정은 내일 한국 시간 00:00에 시작해 {walkingPolicy.durationDays}일 동안 이어집니다.
                      모집 중이거나 진행 중인 원정에는 한 계정당 하나만 참여할 수 있습니다.
                    </p>
                    <p>하루에 10,000걸음까지 원정에 보태며, 팀 단계에서 5P·10P·20P를 받을 수 있습니다.</p>
                    {ongoing.map((expedition) => <ExpeditionCard key={expedition.id} expedition={expedition} disabled={disabled} mutate={command.run} embedded={embedded} />)}
                    {ongoing.length === 0 ? (
                      <>
                        <p>모집 중이거나 진행 중인 원정이 없습니다.</p>
                        <p>원정에 참여하면 동료에게 내 표시 이름과 원정에 보탠 걸음이 공유됩니다.</p>
                        <ExpeditionForms disabled={disabled} mutate={command.run} />
                      </>
                    ) : <p className={styles.note}>현재 원정을 마치거나 나간 뒤 새 원정에 참여할 수 있습니다.</p>}
                    {history.length > 0 ? (
                      <details className={css.history}>
                        <summary>지난 원정과 나간 원정 {history.length}개</summary>
                        {history.map((expedition) => <ExpeditionCard key={expedition.id} expedition={expedition} disabled={disabled} mutate={command.run} embedded={embedded} />)}
                      </details>
                    ) : null}
                  </section>
                  <Rewards data={data} disabled={disabled} mutate={command.run} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </>
  );
}
