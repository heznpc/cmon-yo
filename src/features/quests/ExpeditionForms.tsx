import { useState } from 'react';
import { useLocation } from 'react-router';
import { PlacePicker } from '../places/PlacePicker';
import { form } from '../account/account.css';
import { primary } from '../meetup/meetup.css';
import type { WalkingUICommand } from './useWalkingCommand';
import * as css from './walking.css';

export function ExpeditionForms({
  disabled,
  mutate,
}: {
  disabled: boolean;
  mutate: (input: WalkingUICommand) => Promise<boolean>;
}) {
  const location = useLocation();
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [placeId, setPlaceId] = useState(() => {
    const value = new URLSearchParams(location.search).get('placeId') ?? '';
    return /^park-[0-9]{5}-[0-9]{5}$/.test(value) ? value : '';
  });
  return (
    <div className={css.forms}>
      <form
        className={form}
        aria-labelledby="create-expedition-title"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate({ action: 'createExpedition', title, placeId: placeId || null });
        }}
      >
        <h3 id="create-expedition-title">새 원정 만들기</h3>
        <fieldset disabled={disabled}>
          <legend>함께 걸을 원정</legend>
          <label>
            원정 이름
            <input required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <PlacePicker
            label="관련 공원 (선택)"
            optional
            value={placeId}
            onChange={setPlaceId}
            disabled={disabled}
          />
          <p>공원 연결은 산책 장소 안내입니다. 방문 인증이나 추가 보상이 생기지 않습니다.</p>
          <button className={primary} disabled={disabled || !title.trim()}>원정 만들기</button>
        </fieldset>
      </form>
      <form
        className={form}
        aria-labelledby="join-expedition-title"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate({ action: 'joinExpedition', code });
        }}
      >
        <h3 id="join-expedition-title">초대받은 원정에 참여</h3>
        <fieldset disabled={disabled}>
          <legend>초대 코드로 참여</legend>
          <label>
            초대 코드
            <input
              required
              minLength={12}
              maxLength={12}
              pattern="[A-Z0-9]{12}"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="invite-format"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
            />
          </label>
          <p id="invite-format">영문 대문자와 숫자 12자리입니다. 시작 전인 원정에만 참여할 수 있습니다.</p>
          <button className={primary} disabled={disabled || !/^[A-Z0-9]{12}$/.test(code)}>
            원정 참여하기
          </button>
        </fieldset>
      </form>
    </div>
  );
}
