-- 2.0.1 共创项目角色：发起人 = 项目群聊群主；负责人（project_members.role='lead'）= 项目群聊管理员。两边双向同步。
-- 回填已有项目：群聊里已经是管理员的项目成员 → 负责人；负责人在群里 → 管理员。
UPDATE project_members SET role='lead'
 WHERE role='member' AND status='active' AND EXISTS (
   SELECT 1 FROM projects p JOIN conversation_members cm ON cm.conversation_id=p.conversation_id
    WHERE p.id=project_members.project_id AND cm.user_id=project_members.user_id AND cm.role='admin' AND cm.left_at IS NULL);
UPDATE conversation_members SET role='admin'
 WHERE role='member' AND left_at IS NULL AND EXISTS (
   SELECT 1 FROM projects p JOIN project_members pm ON pm.project_id=p.id
    WHERE p.conversation_id=conversation_members.conversation_id AND pm.user_id=conversation_members.user_id AND pm.role='lead' AND pm.status='active');
