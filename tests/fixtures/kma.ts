// Synthetic response using the official KMA guide's fields. Never a live-weather sample.
export function forecastResponse(url: URL) {
  const baseDate = url.searchParams.get('base_date')!;
  const baseTime = url.searchParams.get('base_time')!;
  const start = new Date(
    `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6)}T${baseTime.slice(0, 2)}:00:00+09:00`,
  ).getTime();
  const item = Array.from({ length: 24 }, (_, i) => {
    const kst = new Date(start + (i + 10) * 3600_000).toISOString();
    return Object.entries({ TMP: '21', POP: '30', PTY: '0', WSD: '2.5' }).map(
      ([category, fcstValue]) => ({
        baseDate,
        baseTime,
        fcstDate: kst.slice(0, 10).replaceAll('-', ''),
        fcstTime: kst.slice(11, 13) + '00',
        category,
        fcstValue,
        nx: Number(url.searchParams.get('nx')),
        ny: Number(url.searchParams.get('ny')),
      }),
    );
  }).flat();
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
      body: { pageNo: 1, totalCount: item.length, items: { item } },
    },
  };
}
