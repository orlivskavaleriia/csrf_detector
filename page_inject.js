;(function(){
  const origFetch = window.fetch;
  const SAFE = ['GET','HEAD','OPTIONS'];
  window.fetch = function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method||'GET').toUpperCase();
    const dest = new URL(url, location.href).origin;
    if (dest !== location.origin && !SAFE.includes(method)) {
      const cookieToken = document.cookie
        .split('; ').find(r=>r.startsWith('XSRF-TOKEN='))?.split('=')[1];
      const headers = new Headers(init.headers||{});
      const headerToken = headers.get('X-XSRF-TOKEN');
      let hasBodyToken = false;
      if (init.body) {
        if (typeof init.body === 'string')           hasBodyToken = init.body.includes('csrf-token=');
        else if (init.body instanceof FormData)      hasBodyToken = init.body.has('csrf-token');
        else if (headers.get('Content-Type')?.includes('application/json')) {
          try{ hasBodyToken = !!JSON.parse(init.body)['csrf-token']; }catch{}
        }
      }
      let msg = `⚠️ CSRF Defender:\n${method} ${url}\nКрос-доменний запит.`;
      if (!cookieToken)      msg += `\n– Відсутній cookie XSRF-TOKEN`;
      if (!headerToken)      msg += `\n– Відсутній заголовок X-XSRF-TOKEN`;
      if (!hasBodyToken)     msg += `\n– Відсутній токен у тілі`;
      msg += `\nПродовжити?`;

      const allow = confirm(msg);
      window.postMessage({ source:'csrf-defender', url, allowed: allow }, '*');
      if (!allow) {
        return Promise.reject(new Error('CSRF fetch blocked'));
      }
    }
    return origFetch.apply(this, arguments);
  };
})();
