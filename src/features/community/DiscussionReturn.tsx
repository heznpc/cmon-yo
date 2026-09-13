import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { nativeBridge, type BridgeClient } from '../../app/bridge';
export function DiscussionReturn({ id }: { id: string }) {
  const [bridge, setBridge] = useState<BridgeClient | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const client = nativeBridge();
    setBridge(client);
    return () => client?.close();
  }, []);
  async function back() {
    if (!bridge || pending) return;
    setPending(true);
    setError('');
    try {
      const result = await bridge.request('openMeetup', { meetupId: id });
      if (result.status !== 'ok') setError('앱으로 돌아가지 못했습니다. 상단 닫기를 눌러 주세요.');
    } catch {
      setError('앱 복귀 응답을 확인하지 못했습니다. 상단 닫기를 눌러 주세요.');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {bridge ? (
        <button disabled={pending} onClick={() => void back()}>
          앱 모임으로 돌아가기
        </button>
      ) : (
        <Link to={'/meetups/' + id}>모임으로 돌아가기</Link>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
