// 密码与令牌：scrypt 加盐哈希（内置，不可还原）；令牌只存哈希。
import {scryptSync, randomBytes, timingSafeEqual, createHash} from 'node:crypto';
const P = {N: 16384, r: 8, p: 1}, KL = 64;
export function hashPassword(pw) {
  const salt = randomBytes(16);
  return ['scrypt', P.N, P.r, P.p, salt.toString('base64'), scryptSync(pw, salt, KL, P).toString('base64')].join('$');
}
export function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, s, h] = stored.split('$'); if (alg !== 'scrypt') return false;
    const want = Buffer.from(h, 'base64'), got = scryptSync(pw, Buffer.from(s, 'base64'), want.length, {N: +N, r: +r, p: +p});
    return timingSafeEqual(want, got);
  } catch { return false; }
}
export const newToken = () => 'nv_' + randomBytes(32).toString('base64url');
export const tokenHash = t => createHash('sha256').update(t).digest('hex');
