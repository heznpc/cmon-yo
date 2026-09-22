import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { walkingPolicy, type WalkingDashboard } from '../../contracts/walking';
import type { WalkingUICommand } from './useWalkingCommand';
import { count } from './DailyWalking';
import * as styles from '../meetup/meetup.css';
import * as css from './walking.css';

type Expedition = WalkingDashboard['expeditions'][number];
const states = { recruiting: '모집 중', active: '걷는 중', ended: '종료', withdrawn: '나간 원정' };

export function ExpeditionCard({
  expedition,
  disabled,
  mutate,
  embedded = false,
}: {
  expedition: Expedition;
  disabled: boolean;
  mutate: (input: WalkingUICommand) => Promise<boolean>;
  embedded?: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const invite = useRef<HTMLInputElement>(null);
  const members = expedition.members.filter((member) => !member.withdrawn).length;
  const ongoing = expedition.state === 'recruiting' || expedition.state === 'active';
  const claimUntil = new Date(Date.parse(expedition.endsOn + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(expedition.inviteCode!);
      setCopyMessage('초대 코드를 복사했습니다.');
    } catch {
      invite.current?.focus();
      invite.current?.select();
      setCopyMessage('자동 복사에 실패했습니다. 선택된 초대 코드를 직접 복사해 주세요.');
    }
  }
  return (
    <section className={css.panel} aria-labelledby={'expedition-' + expedition.id}>
      <div className={css.row}>
        <h3 id={'expedition-' + expedition.id}>{expedition.title}</h3>
        <span className={css.state}>{states[expedition.state]} · {members}/{walkingPolicy.maxMembers}명</span>
      </div>
      <p>
        <time dateTime={expedition.startsOn}>{expedition.startsOn}</time> 00:00 시작 →{' '}
        <time dateTime={expedition.endsOn}>{expedition.endsOn}</time> 00:00 종료 · 한국 시간
      </p>
      {expedition.state === 'recruiting' ? (
        <p>아직 시작 전입니다. 시작일부터 {walkingPolicy.durationDays}일 동안 걸음이 합산됩니다.</p>
      ) : null}
      <dl className={css.stats}>
        <div><dt>함께 모은 걸음</dt><dd>{count(expedition.steps)}걸음</dd></div>
        <div><dt>내가 보탠 걸음</dt><dd>{count(expedition.ownSteps)}걸음</dd></div>
      </dl>
      <p>
        단계 포인트는 내 걸음 {count(walkingPolicy.minimumContribution)}걸음 이상,{' '}
        {count(walkingPolicy.minimumContribution)}걸음 이상 보탠 참가자가 본인을 포함해 {walkingPolicy.minimumContributors}명
        이상일 때 받을 수 있습니다. 현재 {expedition.eligibleContributors}명이 조건을 채웠습니다.
      </p>
      <p>달성한 단계 포인트는 <time dateTime={claimUntil}>{claimUntil}</time> 00:00 전까지 받을 수 있습니다. · 한국 시간</p>
      <div className={css.rows} aria-label="원정 단계">
        {expedition.stages.map((stage) => {
          const state = stage.claimed ? 'claimed' : stage.claimable ? 'available' : 'locked';
          const status = stage.claimed
            ? '✓ 수령 완료'
            : stage.claimable
              ? '● 수령 가능'
              : stage.unlocked
                ? '○ 걸음 달성 · 수령 조건 확인'
                : '○ 도전 중';
          return (
            <div
              key={stage.index}
              className={[css.stage, css[state]].join(' ')}
              role="group"
              aria-labelledby={`stage-${expedition.id}-${stage.index}`}
            >
              <h4 id={`stage-${expedition.id}-${stage.index}`}>
                {stage.title} · {count(stage.threshold)}걸음 · {stage.reward}P
              </h4>
              <p className={css.state}>{status}</p>
              <progress
                className={css.progress}
                max={stage.threshold}
                value={Math.min(expedition.steps, stage.threshold)}
                aria-label={`${stage.title} ${count(Math.min(expedition.steps, stage.threshold))} / ${count(stage.threshold)}걸음`}
              />
              <button
                disabled={disabled || !stage.claimable || stage.claimed}
                onClick={() => void mutate({ action: 'claimStage', expeditionId: expedition.id, stage: stage.index })}
              >
                {stage.claimed ? `${stage.title} 수령 완료` : `${stage.title} ${stage.reward}P 받기`}
              </button>
              {!stage.claimable && !stage.claimed && stage.unlocked ? (
                <p className={styles.note}>
                  {expedition.state === 'withdrawn'
                    ? '나간 원정의 남은 포인트는 받을 수 없습니다.'
                    : '내 걸음 조건과 위의 포인트 수령 기한을 확인해 주세요.'}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <details>
        <summary>동료가 보탠 걸음</summary>
        <p>각자 보탠 걸음을 함께 확인합니다. 순위를 매기지 않습니다.</p>
        <ul aria-label={expedition.title + ' 동료'}>
          {expedition.members.map((member, index) => (
            <li className={css.member} key={index}>
              <span>{member.name}{member.isMe ? ' (나)' : ''}{member.withdrawn ? ' · 나감' : ''}</span>
              <span className={css.number}>{count(member.steps)}걸음</span>
            </li>
          ))}
        </ul>
      </details>
      {expedition.state === 'recruiting' && expedition.inviteCode ? (
        <div className={css.history}>
          <label htmlFor={'invite-' + expedition.id}>이 원정의 초대 코드</label>
          <div className={styles.actions}>
            <input
              id={'invite-' + expedition.id}
              className={css.invite}
              ref={invite}
              readOnly
              value={expedition.inviteCode}
            />
            <button
              onClick={() => void copyInvite()}
            >초대 코드 복사</button>
          </div>
          <p role="status">{copyMessage}</p>
          <p>함께 걸을 동료에게 코드를 알려 주세요. 원정이 시작하면 새로 참여할 수 없습니다.</p>
        </div>
      ) : null}
      {expedition.placeId ? (
        <p><Link target={embedded ? '_blank' : undefined} rel={embedded ? 'noreferrer' : undefined} to={'/places/' + expedition.placeId}>{expedition.placeName ?? '연결된 공원'} 살펴보기</Link></p>
      ) : null}
      <p>
        <Link target={embedded ? '_blank' : undefined} rel={embedded ? 'noreferrer' : undefined} to={'/community/new' + (expedition.placeId ? '?placeId=' + encodeURIComponent(expedition.placeId) : '')}>
          커뮤니티에 공개 산책 후기 쓰기
        </Link>
      </p>
      <p className={styles.note}>후기는 커뮤니티에 공개됩니다. 글 작성과 공원 연결에는 걸음 포인트가 추가되지 않습니다.</p>
      {ongoing ? (
        <div className={styles.actions}>
          {leaving ? (
            <div>
              <p>{expedition.state === 'recruiting'
                ? '모집 중인 원정에서 나갑니다. 원정이 시작하기 전에는 초대 코드로 다시 참여할 수 있습니다.'
                : '나가면 이 원정에 다시 참여하거나 남은 보상을 받을 수 없습니다.'}</p>
              <div className={styles.actions}>
                <button disabled={disabled} onClick={() => void mutate({ action: 'leaveExpedition', expeditionId: expedition.id })}>
                  원정 나가기 확정
                </button>
                <button disabled={disabled} onClick={() => setLeaving(false)}>계속 함께 걷기</button>
              </div>
            </div>
          ) : (
            <button disabled={disabled} onClick={() => setLeaving(true)}>원정 나가기</button>
          )}
        </div>
      ) : null}
    </section>
  );
}
