/* NOVA V5 权限表（纯逻辑，无界面依赖，可在 node 里单测）。
   注意：这是"演示版本地权限"，只决定界面能不能点；真正的权限必须由将来的服务端再校验一次。 */
const RANK={'所有者':4,'管理员':3,'版主':2,'成员':1,'':0};
/* 社区：每个动作需要的最低等级 */
const CMP={post:1,postAnn:2,pinMsg:2,delMsg:2,atAll:3,addChannel:3,editChannel:3,delChannel:3,invite:2,kick:3,setMod:3,setAdmin:4,editInfo:3,dissolve:4};
const canC=(role,act)=>(RANK[role]||0)>=CMP[act]&&(RANK[role]||0)>0;
/* 能不能管理某个成员：只能管理比自己等级低的人，且自己至少是管理员 */
const canManage=(my,target)=>(RANK[my]||0)>=CMP.kick&&(RANK[my]||0)>(RANK[target]||0);
/* 我能把对方设成哪些角色（所有者 → 管理员/版主/成员；管理员 → 版主/成员，且对方必须比我低） */
const assignable=(my,target)=>{if(!canManage(my,target))return[];return my=='所有者'?['管理员','版主','成员']:['版主','成员']};
/* 群聊：群主 > 管理员 > 成员 */
const GR={'群主':3,'管理员':2,'成员':1};
const GRP={pinMsg:2,atAll:2,rename:2,avatar:2,addMember:2,kick:2,setAdmin:3};
const canG=(role,act)=>(GR[role]||0)>=GRP[act];
const canKickG=(my,target)=>(GR[my]||0)>=GRP.kick&&(GR[my]||0)>(GR[target]||0);
if(typeof module!=='undefined')module.exports={RANK,CMP,canC,canManage,assignable,GR,GRP,canG,canKickG};
