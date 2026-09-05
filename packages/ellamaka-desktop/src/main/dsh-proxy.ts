type DshFetch = (input: URL, init: RequestInit) => Promise<Response>
type HeadersWithSetCookie = Headers & { getSetCookie?: () => string[] }

export function isDshPath(pathname: string): boolean {
  return pathname === "/dsh" || pathname.startsWith("/dsh/")
}

export function createDshProxy(fetch: DshFetch) {
  let target: URL | undefined
  const cookies = new Map<string, string>()

  function setTarget(value?: string): void {
    const next = value ? new URL(value) : undefined
    if (target?.origin !== next?.origin) cookies.clear()
    target = next
  }

  async function handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url)
    if (!isDshPath(url.pathname) || !target) return

    const headers = new Headers(request.headers)
    headers.delete("connection")
    headers.delete("content-length")
    headers.delete("cookie")
    headers.delete("host")
    headers.delete("origin")
    headers.delete("referer")
    headers.set("origin", target.origin)
    if (cookies.size) headers.set("cookie", [...cookies.values()].join("; "))

    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      redirect: "manual",
      signal: request.signal,
    }
    if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
      init.body = request.body
      init.duplex = "half"
    }

    const response = await fetch(new URL(url.pathname + url.search, target), init)
    storeCookies(cookies, response.headers)
    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete("set-cookie")
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    })
  }

  return { handle, setTarget }
}

function storeCookies(cookies: Map<string, string>, headers: Headers): void {
  for (const value of setCookieValues(headers)) {
    const pair = value.split(";", 1)[0]?.trim()
    if (!pair) continue
    const separator = pair.indexOf("=")
    if (separator <= 0) continue
    const name = pair.slice(0, separator)
    if (/(?:^|;)\s*max-age=0(?:;|$)/i.test(value)) {
      cookies.delete(name)
      continue
    }
    cookies.set(name, pair)
  }
}

function setCookieValues(headers: Headers): string[] {
  const getSetCookie = (headers as HeadersWithSetCookie).getSetCookie
  const values = getSetCookie?.call(headers)
  if (values?.length) return values
  const value = headers.get("set-cookie")
  return value ? [value] : []
}
