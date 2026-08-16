const PORTAL_SCRIPTS = '<script src="/membership-portal.js?v=20260801-membership-2" defer></script><script src="/membership-refresh-reconcile.js?v=20260816-refresh-1" defer></script><script src="/logout-immediate.js?v=20260801-signout-2" defer></script><script src="/auth-route-defer.js?v=20260802-login-2" defer></script>';
const BODY_MARKER = '</body>';
const SUPABASE_ALIAS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const SUPABASE_PINNED = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0';
const TAIL_LENGTH = Math.max(BODY_MARKER.length, SUPABASE_ALIAS.length) - 1;

type EdgeContext = {
  next: () => Promise<Response>;
};

export default async (_request: Request, context: EdgeContext) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') || !response.body) return response;

  let tail = '';
  let scriptsInjected = false;
  let supabasePinned = false;

  const injector = new TransformStream<string, string>({
    transform(chunk, controller) {
      let combined = tail + chunk;

      if (!supabasePinned) {
        const index = combined.indexOf(SUPABASE_ALIAS);
        if (index >= 0) {
          combined = combined.slice(0, index) + SUPABASE_PINNED + combined.slice(index + SUPABASE_ALIAS.length);
          supabasePinned = true;
        }
      }

      if (!scriptsInjected) {
        const index = combined.indexOf(BODY_MARKER);
        if (index >= 0) {
          combined = combined.slice(0, index) + PORTAL_SCRIPTS + combined.slice(index);
          scriptsInjected = true;
        }
      }

      if (combined.length > TAIL_LENGTH) {
        controller.enqueue(combined.slice(0, -TAIL_LENGTH));
        tail = combined.slice(-TAIL_LENGTH);
      } else {
        tail = combined;
      }
    },
    flush(controller) {
      if (tail) controller.enqueue(tail);
    },
  });

  const body = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(injector)
    .pipeThrough(new TextEncoderStream());

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const config = { path: ['/', '/index.html'] };
