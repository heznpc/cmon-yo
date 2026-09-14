import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { meetingInputSchema, type Meeting, type MeetingInput } from '../../contracts/meetings';
import { PlacePicker } from '../places/PlacePicker';
import { form } from '../account/account.css';
import { primary } from './meetup.css';
import { useMeetingCommand } from './useMeetingCommand';
const sports = { walking: '걷기', running: '달리기', cycling: '자전거' };
function localTime(iso: string) {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function MeetingEditor({
  userId,
  initial,
  placeId,
  ready,
  onSaved,
}: {
  userId: string;
  initial?: Meeting;
  placeId?: string;
  ready: boolean;
  onSaved?: () => Promise<void>;
}) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [baseVersion] = useState(initial?.version);
  const [selectedPlace, setSelectedPlace] = useState(initial?.place.id ?? placeId ?? '');
  const command = useMeetingCommand(
    userId,
    'editor:' + (initial?.id ?? 'new'),
    ready,
    async (id) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['meetings', 'list'] }),
        client.invalidateQueries({ queryKey: ['private', userId, 'meetings'] }),
      ]);
      if (onSaved) await onSaved();
      else navigate(`/meetups/${id}`);
    },
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    try {
      const input: MeetingInput = meetingInputSchema.parse({
        title: data.get('title'),
        description: data.get('description'),
        sport: data.get('sport'),
        placeId: data.get('placeId'),
        startsAt: new Date(`${data.get('startDate')}T${data.get('startTime')}`).toISOString(),
        endsAt: new Date(`${data.get('endDate')}T${data.get('endTime')}`).toISOString(),
        capacity: Number(data.get('capacity')),
      });
      await command.run(
        initial ? `/api/v1/meetups/${initial.id}` : '/api/v1/meetups',
        initial ? 'PATCH' : 'POST',
        initial ? { action: 'edit', expectedVersion: baseVersion, input } : input,
      );
    } catch {
      command.setError('제목·시설·시작과 종료 시간·정원을 확인해 주세요.');
    }
  }
  return (
    <section aria-label={initial ? '모임 수정 양식' : '모임 작성 양식'}>
      <form className={form} onSubmit={(e) => void submit(e)}>
        <fieldset disabled={!ready || command.pending || !!command.unknown}>
          <legend>{initial ? '모임 수정' : '운동 약속'}</legend>
          <label>
            제목
            <input name="title" required maxLength={120} defaultValue={initial?.title} />
          </label>
          <label>
            설명
            <textarea name="description" maxLength={2000} defaultValue={initial?.description} />
          </label>
          <label>
            종목
            <select name="sport" defaultValue={initial?.sport ?? 'walking'}>
              {Object.entries(sports).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <PlacePicker
            name="placeId"
            value={selectedPlace}
            onChange={setSelectedPlace}
            disabled={!ready || command.pending || !!command.unknown}
          />
          <p>입력 시간은 이 기기의 현지 시간이며 상세에는 한국 시간으로 표시됩니다.</p>
          <label>
            시작 날짜
            <input
              name="startDate"
              type="date"
              required
              defaultValue={initial ? localTime(initial.startsAt).slice(0, 10) : undefined}
            />
          </label>
          <label>
            시작 시간
            <input
              name="startTime"
              type="time"
              required
              defaultValue={initial ? localTime(initial.startsAt).slice(11) : undefined}
            />
          </label>
          <label>
            종료 날짜
            <input
              name="endDate"
              type="date"
              required
              defaultValue={initial ? localTime(initial.endsAt).slice(0, 10) : undefined}
            />
          </label>
          <label>
            종료 시간
            <input
              name="endTime"
              type="time"
              required
              defaultValue={initial ? localTime(initial.endsAt).slice(11) : undefined}
            />
          </label>
          <label>
            정원 · 주최자 포함
            <input
              name="capacity"
              type="number"
              min={2}
              max={100}
              required
              defaultValue={initial?.capacity ?? 6}
            />
          </label>
          <button className={primary} disabled={!selectedPlace}>
            {initial ? '수정 저장' : '모임 생성'}
          </button>
        </fieldset>
      </form>
      {command.feedback}
    </section>
  );
}
