export default async (_request: Request, context: { next: () => Promise<Response> }) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const membershipScript = '<script src="/membership-portal.js?v=20260801-membership-2" defer></script>';
  const logoutScript = '<script src="/logout-immediate.js?v=20260801-signout-2" defer></script>';
  const authRoutingScript = '<script src="/auth-route-defer.js?v=20260801-login-1" defer></script>';
  if (html.includes('/auth-route-defer.js') || !html.includes('</body>')) {
    return new Response(html, response);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html.replace('</body>', `${membershipScript}${logoutScript}${authRoutingScript}</body>`), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const config = { path: "/*" };
