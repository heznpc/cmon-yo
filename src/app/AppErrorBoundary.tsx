import { Component, type ReactNode } from 'react';
import { reportClientEvent } from '../api/telemetry';

export class AppErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    reportClientEvent({ event: 'browser_error' });
  }

  componentDidUpdate(previous: Readonly<{ children: ReactNode; resetKey: string }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main id="page-content" tabIndex={-1}>
        <h1>화면을 표시하지 못했습니다.</h1>
        <p role="alert">연결을 확인한 뒤 화면을 다시 불러와 주세요.</p>
        <button onClick={() => window.location.reload()}>화면 다시 불러오기</button>{' '}
        <a href="/places">시설 목록으로 이동</a>
      </main>
    );
  }
}
