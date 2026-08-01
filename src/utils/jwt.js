import { jwtDecode } from 'jwt-decode';

// AUTH-03: client-side check of the JWT's exp claim, used only while online — an
// offline-but-clock-expired token must still be trusted (AUTH-02).
export function isTokenExpired(token) {
  try {
    const { exp } = jwtDecode(token);
    if (!exp) return false;
    return Date.now() >= exp * 1000;
  } catch {
    return true;
  }
}
