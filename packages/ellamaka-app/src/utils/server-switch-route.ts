export function serverSwitchRedirect(pathname: string): "/" | undefined {
  if (pathname === "/workbench" || pathname.startsWith("/workbench/")) return
  return "/"
}
