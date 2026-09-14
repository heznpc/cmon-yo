import { useInRouterContext, useLocation } from 'react-router';
import { AppLink } from './navigation';
import { Icon } from './Icon';
import * as css from '../features/meetup/meetup.css';
const items = [
  { href: '/places', label: '둘러보기', icon: 'places' },
  { href: '/meetups', label: '모임', icon: 'meetings' },
  { href: '/community', label: '커뮤니티', icon: 'community' },
  { href: '/activity', label: '내 활동', icon: 'activity' },
] as const;
export function ProductNav() {
  return useInRouterContext() ? <RoutedNav /> : <Navigation pathname="" />;
}
function RoutedNav() {
  return <Navigation pathname={useLocation().pathname} />;
}
function Navigation({ pathname }: { pathname: string }) {
  return (
    <header className={css.header}>
      <a className={css.skip} href="#page-content">
        본문 바로가기
      </a>
      <div className={css.headerInner}>
        <AppLink className={css.wordmark} href="/places" aria-label="C'mon Yo! 홈">
          C’mon Yo!
        </AppLink>
        <nav aria-label="주 메뉴" className={css.primaryNav}>
          {items.map(({ href, label, icon }) => (
            <AppLink
              key={href}
              href={href}
              className={css.navLink}
              aria-current={
                pathname === href ||
                pathname.startsWith(href + '/') ||
                (href === '/community' && pathname === '/account/posts')
                  ? 'page'
                  : undefined
              }
            >
              <Icon name={icon} />
              <span>{label}</span>
            </AppLink>
          ))}
        </nav>
        <span className={css.location}>
          <Icon name="pin" />
          내 위치
        </span>
        <nav aria-label="계정 메뉴" className={css.utilityNav}>
          <AppLink
            href="/account/meetups"
            aria-label="내 모임"
            className={css.navLink}
            aria-current={pathname === '/account/meetups' ? 'page' : undefined}
          >
            <Icon name="calendar" />
            <span>내 모임</span>
          </AppLink>
          <AppLink
            href="/account"
            aria-label="내 계정"
            className={css.navLink}
            aria-current={pathname === '/account' ? 'page' : undefined}
          >
            <Icon name="activity" />
            <span>내 계정</span>
          </AppLink>
        </nav>
      </div>
    </header>
  );
}
