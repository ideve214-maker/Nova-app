// M5.4.4 数据导出：资料、动态、消息。端到端密文原样给出，明文由客户端解密后写入导出文件。
export function createExporter(db, {now, posts, profile, chats, vip, saved} = {}) {
  const myCvs = db.prepare(`SELECT c.* FROM conversations c
    JOIN conversation_members m ON m.conversation_id=c.id
    WHERE m.user_id=? AND (c.deleted_at IS NULL OR c.deleted_at=0 OR c.deleted_at IS NULL)
    ORDER BY c.created_at`);
  // conversations may not have deleted_at
  const myCvs2 = db.prepare(`SELECT c.* FROM conversations c
    JOIN conversation_members m ON m.conversation_id=c.id
    WHERE m.user_id=? ORDER BY c.created_at`);
  const msgsQ = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, id');

  function allPosts(user) {
    if (!posts) return [];
    const out = [];
    let cursor = null;
    for (let i = 0; i < 100; i++) {
      const r = posts.list(user, {author: 'me', limit: 50, ...(cursor ? {cursor} : {})});
      out.push(...(r.posts || []));
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return out;
  }

  function exportAll(user) {
    const prof = profile ? profile.publicOf(user) : {username: user.username, id: user.id};
    const privacy = profile && profile.privacyOf ? profile.privacyOf(user) : null;
    const vipSt = vip && vip.status ? vip.status(user) : null;
    let conversations = [];
    try {
      const cvs = myCvs2.all(user.id);
      conversations = cvs.map(c => {
        const rows = msgsQ.all(c.id);
        const messages = rows.map(r => {
          const m = chats ? chats.pubMsg(r, user) : r;
          if (m && m.encrypted) {
            return {
              ...m,
              text: '',
              ciphertext: m.ciphertext,
              encrypted: true,
              e2eeExport: 'ciphertext-only',
            };
          }
          return m;
        });
        return {
          id: c.id,
          kind: c.kind,
          name: c.name,
          messages,
        };
      });
    } catch (e) {
      conversations = [{error: e.message}];
    }
    return {
      exportedAt: now(),
      version: 1,
      e2eeNote: '加密消息只包含密文，不含明文。请在客户端用本机密钥解密后再写入导出文件。服务端不会也不能解密。',
      profile: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at,
        display: prof,
        privacy,
        vip: vipSt ? {active: !!vipSt.active, until: vipSt.active ? vipSt.until : null} : undefined,
      },
      posts: allPosts(user),
      conversations,
      saved: saved && saved.list ? saved.list(user).items : undefined,
    };
  }
  return {exportAll};
}
