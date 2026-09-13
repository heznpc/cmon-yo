import { AppLink } from './navigation';
import * as css from '../features/meetup/meetup.css';
export function ProductNav() {
  return (
    <nav aria-label="주 메뉴" className={css.actions}>
      <AppLink href="/places">둘러보기</AppLink>
      <AppLink href="/meetups">모임</AppLink>
      <AppLink href="/community">커뮤니티</AppLink>
      <AppLink href="/activity">내 활동</AppLink>
      <AppLink href="/account/meetups">내 모임</AppLink>
      <AppLink href="/account">내 계정</AppLink>
    </nav>
  );
}
