export const errorPage = (message: string) =>
  `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C'mon Yo! · 오류</title><main><h1>${message.replace(/[&<>"']/g, (value) => `&#${value.charCodeAt(0)};`)}</h1><p>주소나 연결 상태를 확인해 주세요.</p><a href="">다시 시도</a></main></html>`;
