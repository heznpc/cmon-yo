import type { WalkingDashboard } from '../../contracts/walking';
import type { WalkingUICommand } from './useWalkingCommand';
import * as styles from '../meetup/meetup.css';
import * as css from './walking.css';

export const count = (value: number) => value.toLocaleString('ko-KR');
export function koreaTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function DailyWalking({
  data,
  disabled,
  mutate,
}: {
  data: WalkingDashboard;
  disabled: boolean;
  mutate: (input: WalkingUICommand) => Promise<boolean>;
}) {
  const today = data.days.find((day) => day.day === data.today);
  return (
    <section className={css.panel} aria-labelledby="daily-title">
      <h2 id="daily-title">혼자 걷기</h2>
      <p>
        한국 시간 하루 {count(data.dailyCap)}걸음까지, {count(data.stepsPerPoint)}걸음마다 1P를
        받습니다. 더 걸으면 그날 남은 포인트를 추가로 받을 수 있습니다.
      </p>
      <p><time dateTime={data.today}>{data.today}</time> · 오늘</p>
      <dl className={css.stats}>
        <div><dt>건강 앱에서 마지막으로 읽은 걸음</dt><dd>{today ? `${count(today.steps)}걸음` : '아직 기록 없음'}</dd></div>
        <div><dt>오늘 보상에 반영한 걸음</dt><dd>{count(today?.creditedSteps ?? 0)}걸음</dd></div>
        <div><dt>오늘 받은 포인트</dt><dd>{today?.claimedPoints ?? 0}P</dd></div>
      </dl>
      <progress
        className={css.progress}
        max={data.dailyCap}
        value={today?.creditedSteps ?? 0}
        aria-label={`오늘 보상 걸음 ${count(today?.creditedSteps ?? 0)} / ${count(data.dailyCap)}걸음`}
      />
      <p className={styles.note}>
        건강 앱 기록이 수정되어도 이미 반영한 걸음과 받은 포인트는 줄지 않습니다.
        이 때문에 두 걸음 수가 다를 수 있습니다.
      </p>
      <button
        className={styles.primary}
        disabled={disabled || !today || today.availablePoints === 0}
        onClick={() => today && void mutate({ action: 'claimDaily', day: today.day })}
      >
        {today?.availablePoints ? `오늘 ${today.availablePoints}P 받기` : '오늘 받을 포인트 없음'}
      </button>
      <details className={css.history}>
        <summary>최근 8일의 걸음과 포인트</summary>
        <p>오늘을 포함한 최근 8일 기록입니다. 아직 받지 않은 포인트도 여기서 받을 수 있습니다.</p>
        <ul aria-label="최근 8일 기록">
          {data.days.map((day) => (
            <li key={day.day}>
              <div className={css.row}>
                <div>
                  <h3><time dateTime={day.day}>{day.day}</time>{day.day === data.today ? ' · 오늘' : ''}</h3>
                  <p>
                    건강 앱 {count(day.steps)}걸음 · 보상 반영 {count(day.creditedSteps)}걸음
                  </p>
                  <p>받은 포인트 {day.claimedPoints}P · 받을 수 있는 포인트 {day.availablePoints}P</p>
                </div>
                <button
                  disabled={disabled || day.availablePoints === 0}
                  aria-label={`${day.day} ${day.availablePoints}P 받기`}
                  onClick={() => void mutate({ action: 'claimDaily', day: day.day })}
                >
                  {day.availablePoints > 0 ? `${day.availablePoints}P 받기` : '받을 포인트 없음'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {data.days.length === 0 ? <p>iOS 앱에서 건강 앱 걸음을 연결하면 기록이 표시됩니다.</p> : null}
      </details>
    </section>
  );
}
