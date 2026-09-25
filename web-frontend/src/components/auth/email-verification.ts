/** The 401 message auth-user-service returns when an unverified account signs in. */
export function isEmailNotVerifiedMessage(message: string | null | undefined): boolean {
  return Boolean(message && message.toLowerCase().includes('verify your email'))
}
