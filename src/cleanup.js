/**
 * 定时清理模块：自动删除1天前的历史邮箱和邮件
 * @module cleanup
 */

import { getInitializedDatabase } from './db/index.js';

/**
 * 运行清理任务
 * @param {object} env - Worker 环境变量
 * @param {object} ctx - ExecutionContext
 */
export async function runCleanup(env, ctx) {
  const DB = await getInitializedDatabase(env);
  const r2 = env.MAIL_EML;
  const results = { mailboxes: 0, messages: 0, r2Objects: 0, r2Total: 0, errors: [] };

  try {
    // 1. 获取1天前的 messages 的 R2 object_key（必须在删除数据库记录前拿到）
    const { results: msgResults } = await DB.prepare(`
      SELECT m.r2_object_key
      FROM messages m
      JOIN mailboxes mb ON mb.id = m.mailbox_id
      WHERE mb.created_at < datetime('now', '-1 day')
        AND m.r2_object_key IS NOT NULL
        AND m.r2_object_key <> ''
    `).all();

    const r2Keys = (msgResults || [])
      .map(r => r.r2_object_key)
      .filter(Boolean);
    results.r2Total = r2Keys.length;

    // 2. 批量删除 R2 中的邮件文件（每批50个并行删除，避免超时）
    if (r2 && r2Keys.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < r2Keys.length; i += BATCH_SIZE) {
        const batch = r2Keys.slice(i, i + BATCH_SIZE);
        const deleteResults = await Promise.allSettled(
          batch.map(key => r2.delete(key))
        );
        for (const r of deleteResults) {
          if (r.status === 'fulfilled') {
            results.r2Objects++;
          } else {
            results.errors.push(`R2 delete error: ${r.reason?.message || r.reason}`);
          }
        }
      }
    }

    // 3. 先删除1天前的 messages（messages 表外键无 ON DELETE CASCADE，必须先删）
    const oldMsgResult = await DB.prepare(`
      DELETE FROM messages WHERE mailbox_id IN (
        SELECT id FROM mailboxes WHERE created_at < datetime('now', '-1 day')
      )
    `).run();
    results.messages = oldMsgResult.meta?.changes || 0;

    // 4. 删除1天前的 user_mailboxes（虽然带 ON DELETE CASCADE，但 D1 有时不自动触发）
    await DB.prepare(`
      DELETE FROM user_mailboxes WHERE mailbox_id IN (
        SELECT id FROM mailboxes WHERE created_at < datetime('now', '-1 day')
      )
    `).run();

    // 5. 删除1天前的 mailboxes
    const mbResult = await DB.prepare(`
      DELETE FROM mailboxes WHERE created_at < datetime('now', '-1 day')
    `).run();
    results.mailboxes = mbResult.meta?.changes || 0;

    // 6. 清理孤立 messages（保险起见）
    const orphanResult = await DB.prepare(`
      DELETE FROM messages WHERE received_at < datetime('now', '-1 day')
    `).run();
    results.messages += orphanResult.meta?.changes || 0;

    console.log('[cleanup]', JSON.stringify(results));
    return results;
  } catch (err) {
    console.error('[cleanup] error:', err);
    results.errors.push(err.message);
    return results;
  }
}
