export function isAdmin(user) {
  return user?.app_metadata?.role === 'admin'
}
