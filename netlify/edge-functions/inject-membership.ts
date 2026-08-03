const PORTAL_SCRIPTS = '<script src="/membership-portal.js?v=20260801-membership-2" defer></script><script src="/logout-immediate.js?v=20260801-signout-2" defer></script><script src="/auth-route-defer.js?v=20260802-login-2" defer></script>';
const MARKER = '</body>';
const TAIL_LENGTH = MARKER.length - 1;

type EdgeContext = {
  next: () => Promise<Response>;
};

export default async (_request: Request, context: EdgeContext) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') || !response.body) return response;

  let tail = '';
  let injected = false;

  const injector = new TransformStream<string, string>({
    transform(chunk, controller) {
      if (injected) {
        controller.enqueue(chunk);
        return;
      }

      const combined = tail + chunk;
      const markerIndex = combined.indexOf(MARKER);
      if (markerIndex >= 0) {
        controller.enqueue(
          combined.slice(0, markerIndex) + PORTAL_SCRIPTS + combined.slice(markerIndex),
        );
        tail = '';
        injected = true;
        return;
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

export const config = { path: '/*' };
