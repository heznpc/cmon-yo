import type { WalkingDashboard } from '../../contracts/walking';
import type { WalkingUICommand } from './useWalkingCommand';
import { count, koreaTime } from './DailyWalking';
import * as css from './walking.css';

export function Rewards({
  data,
  disabled,
  mutate,
}: {
  data: WalkingDashboard;
  disabled: boolean;
  mutate: (input: WalkingUICommand) => Promise<boolean>;
}) {
  return (
    <>
      <section className={css.panel} aria-labelledby="rewards-title">
        <h2 id="rewards-title">배지 교환</h2>
        <p>걷기로 모은 포인트를 배지로 바꾸세요. 각 배지는 한 번만 교환할 수 있습니다.</p>
        <p>사용 가능한 포인트 <strong className={css.balance}>{count(data.balance)}P</strong></p>
        <ul aria-label="교환할 배지">
          {data.catalog.map((badge) => {
            const id = badge.id;
            const known = id === 'sprout' || id === 'trail' || id === 'summit';
            const shortfall = Math.max(0, badge.price - data.balance);
            return (
              <li key={id}>
                <div className={css.row}>
                  <div>
                    <h3>{badge.title}</h3>
                    <p>{badge.price}P · {badge.owned ? '보유 중' : shortfall ? `${shortfall}P 더 필요` : '교환 가능'}</p>
                  </div>
                  <button
                    disabled={disabled || badge.owned || shortfall > 0 || !known}
                    onClick={() => {
                      if (id === 'sprout' || id === 'trail' || id === 'summit')
                        void mutate({ action: 'redeemBadge', badgeId: id });
                    }}
                  >
                    {badge.owned ? `${badge.title} 보유 중` : `${badge.title} ${badge.price}P로 교환`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className={css.panel} aria-labelledby="ledger-title">
        <h2 id="ledger-title">포인트 내역</h2>
        {data.ledger.length === 0 ? <p>아직 받은 포인트와 교환 내역이 없습니다.</p> : (
          <ul aria-label="포인트 내역">
            {data.ledger.map((entry) => (
              <li key={entry.id} className={css.row}>
                <div>
                  <p>{entry.title}</p>
                  <time dateTime={entry.createdAt}>{koreaTime(entry.createdAt)} · 한국 시간</time>
                </div>
                <strong className={css.number}>{entry.amount > 0 ? '+' : ''}{count(entry.amount)}P</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
