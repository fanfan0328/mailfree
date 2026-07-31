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
  const results = { mailboxes: 0, messages: 0, r2Objects: 0, errors: [] };

  try {
    // 1. 获取1天前的 messages 的 R2 object_key（mailbox 级联删除前必须先拿到）
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

    // 2. 删除 R2 中的邮件文件
    if (r2 && r2Keys.length > 0) {
      for (const key of r2Keys) {
        try {
          await r2.delete(key);
          results.r2Objects++;
        } catch (e) {
          results.errors.push(`R2 delete ${key}: ${e.message}`);
        }
      }
    }

    // 3. 删除1天前的 mailboxes（外键级联会自动删除关联的 messages 和 user_mailboxes）
    const mbResult = await DB.prepare(`
      DELETE FROM mailboxes WHERE created_at < datetime('now', '-1 day')
    `).run();
    results.mailboxes = mbResult.meta?.changes || 0;

    // 4. 清理已删除 mailbox 的孤立 messages（保险起见）
    const orphanResult = await DB.prepare(`
      DELETE FROM messages WHERE received_at < datetime('now', '-1 day')
    `).run();
    results.messages = orphanResult.meta?.changes || 0;

    console.log('[cleanup]', JSON.stringify(results));
    return results;
  } catch (err) {
    console.error('[cleanup] error:', err);
    results.errors.push(err.message);
    return results;
  }
}
