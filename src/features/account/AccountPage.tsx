import { clearRecovery } from '../recovery/storage';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountKey, accountSchema, type Account } from '../../contracts/account';
import * as css from '../meetup/meetup.css';
import { form as formStyle } from './account.css';
import { markIdentityChanging } from '../../app/navigation';
import { ProductNav } from '../../app/ProductNav';

export type AccountRoute = {
  section: 'account';
  userId: string | null;
  returnTo: string;
  mode: 'login' | 'reset';
  callbackFailed?: boolean;
  passwordChanged?: boolean;
};
type Mode = 'login' | 'signup' | 'forgot' | 'reset';
const labels: Record<Mode, string> = {
  login: '로그인',
  signup: '회원가입',
  forgot: '비밀번호 재설정 메일 받기',
  reset: '새 비밀번호 저장',
};

async function authAction(path: string, body: object) {
  const response = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const details = result && typeof result === 'object' && 'error' in result ? result.error : null;
    const code = details && typeof details === 'object' && 'code' in details ? details.code : '';
    throw new Error(
      code === 'EMAIL_NOT_VERIFIED'
        ? '이메일 인증을 완료해 주세요. 인증 메일을 확인해 주세요.'
        : response.status === 429
          ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
          : '요청을 처리하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.',
    );
  }
  return result;
}
export function AccountPage({ route }: { route: AccountRoute }) {
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>(route.mode);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(
    route.passwordChanged ? '비밀번호를 변경했습니다. 다시 로그인해 주세요.' : '',
  );
  const [error, setError] = useState(
    route.callbackFailed
      ? '인증을 완료하지 못했습니다. 로그인하거나 메일을 다시 요청해 주세요.'
      : '',
  );
  const [providers, setProviders] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const accountReturn = `/account?returnTo=${encodeURIComponent(route.returnTo)}`;
  const status = useRef<HTMLParagraphElement>(null);
  const accountChannel = useRef<BroadcastChannel | null>(null);
  const identityChanging = useRef(false);
  const query = useQuery<Account>({
    queryKey: accountKey(route.userId),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/v1/me', { signal, credentials: 'same-origin' });
      if (response.status === 401) return { user: null };
      if (!response.ok) throw new Error('계정 조회에 실패했습니다.');
      const account = accountSchema.parse(await response.json());
      if (account.user && account.user.id !== route.userId) {
        if (identityChanging.current) return { user: null };
        // A session can change outside this tab. Never store another user's
        // response under the identity embedded in this page's SSR state.
        window.location.reload();
        throw new Error('계정이 변경되어 화면을 다시 불러옵니다.');
      }
      return account;
    },
  });
  const user = query.isError ? null : query.data?.user;
  // SSR inputs must wait for hydration, and an outgoing account document must
  // stay locked until navigation finishes so typed values cannot be discarded.
  const formDisabled = !ready || pending || identityChanging.current;
  useEffect(() => {
    setReady(true);
    const controller = new AbortController();
    void fetch('/api/auth/providers', { signal: controller.signal })
      .then(async (response) => {
        const value = await response.json();
        if (response.ok && Array.isArray(value.providers))
          setProviders(
            value.providers.filter((p: unknown) =>
              ['google', 'kakao', 'naver', 'apple'].includes(String(p)),
            ),
          );
      })
      .catch(() => {});
    const channel = new BroadcastChannel('cmon-account');
    accountChannel.current = channel;
    channel.onmessage = () => {
      void client.cancelQueries({ queryKey: ['private'] }).then(() => {
        client.removeQueries({ queryKey: ['private'] });
        window.location.reload();
      });
    };
    return () => {
      controller.abort();
      channel.close();
      accountChannel.current = null;
    };
  }, [client]);
  useEffect(() => {
    if (error) status.current?.focus();
  }, [error]);
  async function changeIdentity(destination: string) {
    identityChanging.current = true;
    clearRecovery();
    markIdentityChanging();
    await client.cancelQueries({ queryKey: ['private'] });
    client.removeQueries({ queryKey: ['private'] });
    // Posting through the listening instance notifies other tabs, not this one.
    // A second instance in this tab would race its own reload against returnTo.
    accountChannel.current?.postMessage('changed');
    window.location.assign(destination);
  }
  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      identityChanging.current = false;
      setError(e instanceof Error ? e.message : '다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(async () => {
      const password = String(data.get('password') ?? '');
      if (mode === 'signup') {
        await authAction('sign-up/email', {
          name: String(data.get('name')),
          email,
          password,
          callbackURL: accountReturn,
        });
        setMessage('인증 메일을 확인한 뒤 로그인해 주세요.');
        setMode('login');
      } else if (mode === 'login') {
        identityChanging.current = true;
        await authAction('sign-in/email', { email, password });
        await changeIdentity(route.returnTo);
      } else if (mode === 'forgot') {
        await authAction('request-password-reset', {
          email,
          redirectTo: `${accountReturn}&mode=reset`,
        });
        setMessage('등록된 계정이면 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.');
      } else {
        const token = new URLSearchParams(window.location.search).get('token');
        if (!token) throw new Error('재설정 주소가 올바르지 않습니다. 메일을 다시 요청해 주세요.');
        await authAction('reset-password', { token, newPassword: password });
        await changeIdentity(`${accountReturn}&passwordChanged=1`);
      }
    });
  }
  return (
    <>
      <ProductNav />
      <main id="page-content" tabIndex={-1} className={css.page}>
        <div className={css.account}>
          <h1>내 계정</h1>
          <p role="alert" tabIndex={-1} ref={status}>
            {error || (query.isError ? '계정 정보를 확인하지 못했습니다. 다시 시도해 주세요.' : '')}
          </p>
          <p role="status">{pending ? '처리 중…' : message}</p>
          {query.isError ? (
            <button disabled={query.isFetching} onClick={() => void query.refetch()}>
              계정 다시 조회
            </button>
          ) : null}
          {user && mode !== 'reset' ? (
            <section aria-label="로그인한 계정">
              <p>{user.name}님</p>
              <p>{user.email}</p>
              <button
                disabled={formDisabled}
                onClick={() =>
                  void run(async () => {
                    await authAction('sign-out', {});
                    await changeIdentity('/account');
                  })
                }
              >
                로그아웃
              </button>
              <button
                disabled={formDisabled}
                onClick={() =>
                  void run(async () => {
                    await authAction('delete-user', { callbackURL: '/account' });
                    setMessage('탈퇴 확인 메일을 확인해 주세요.');
                  })
                }
              >
                계정 탈퇴 메일 받기
              </button>
            </section>
          ) : (
            <>
              <h2>{labels[mode]}</h2>
              <form className={formStyle} onSubmit={(event) => void submit(event)}>
                {mode === 'signup' ? (
                  <label>
                    닉네임
                    <input
                      name="name"
                      required
                      maxLength={60}
                      autoComplete="nickname"
                      disabled={formDisabled}
                    />
                  </label>
                ) : null}
                {mode !== 'reset' ? (
                  <label>
                    이메일
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      disabled={formDisabled}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </label>
                ) : null}
                {mode !== 'forgot' ? (
                  <label>
                    비밀번호
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={12}
                      maxLength={128}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      disabled={formDisabled}
                    />
                    <span>12~128자</span>
                  </label>
                ) : null}
                <button className={css.primary} disabled={formDisabled}>
                  {labels[mode]}
                </button>
              </form>
              <div className={css.actions}>
                {(['login', 'signup', 'forgot'] as const)
                  .filter((item) => item !== mode)
                  .map((item) => (
                    <button
                      key={item}
                      disabled={formDisabled}
                      onClick={() => {
                        setMode(item);
                        setError('');
                        setMessage('');
                      }}
                    >
                      {labels[item]}
                    </button>
                  ))}
              </div>
              <button
                disabled={formDisabled || !email}
                onClick={() =>
                  void run(async () => {
                    await authAction('send-verification-email', {
                      email,
                      callbackURL: accountReturn,
                    });
                    setMessage('인증이 필요한 계정이면 메일을 보냈습니다.');
                  })
                }
              >
                인증 메일 다시 받기
              </button>
              {providers.map((provider) => (
                <button
                  key={provider}
                  disabled={formDisabled}
                  onClick={() =>
                    void run(async () => {
                      const result = await authAction('sign-in/social', {
                        provider,
                        callbackURL: route.returnTo,
                        errorCallbackURL: '/account',
                        disableRedirect: true,
                      });
                      if (
                        !result ||
                        typeof result !== 'object' ||
                        !('url' in result) ||
                        typeof result.url !== 'string'
                      )
                        throw new Error('로그인을 시작하지 못했습니다.');
                      const url = new URL(result.url);
                      if (url.protocol !== 'https:')
                        throw new Error('로그인 주소를 확인하지 못했습니다.');
                      window.location.assign(url.href);
                    })
                  }
                >
                  {
                    (
                      {
                        google: 'Google',
                        kakao: '카카오',
                        naver: '네이버',
                        apple: 'Apple',
                      } as Record<string, string>
                    )[provider]
                  }{' '}
                  로그인
                </button>
              ))}
            </>
          )}
        </div>
      </main>
    </>
  );
}
