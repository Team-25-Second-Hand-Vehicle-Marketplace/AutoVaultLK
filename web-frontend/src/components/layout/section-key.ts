/**
 * Pages inside the dealer and admin layouts animate within the layout (the
 * sidebar stays put), so the outer transition only fires when entering or
 * leaving those sections. Their login/register screens are standalone pages.
 */
export function sectionKey(pathname: string): string {
  const standalone = ['/dealer/login', '/dealer/register', '/admin/login']
  if (standalone.includes(pathname)) return pathname
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  if (pathname === '/dealer' || pathname.startsWith('/dealer/')) return 'dealer'
  return pathname
}
