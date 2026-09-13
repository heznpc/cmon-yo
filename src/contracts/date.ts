export function displayDate(value: string) {
  // ICU versions disagree on Korean day periods (AM versus 오전). Use numeric parts.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US-u-nu-latn', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}년 ${parts.month}월 ${parts.day}일 ${parts.hour}:${parts.minute}`;
}
