export default async (_request: Request, context: { next: () => Promise<Response> }) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const membershipScript = '<script src="/membership-portal.js" defer></script>';
  if (html.includes('/membership-portal.js') || !html.includes('</body>')) {
    return new Response(html, response);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html.replace('</body>', `${membershipScript}</body>`), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const config = { path: "/*" };
