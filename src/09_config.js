/* ---- 用户端可调配置（r7）：改这里即可，热更新生效；也可以在主脚本之前用 window.NOVA_* 覆盖 ----
   postLinkBase       “复制帖子链接”用的网页地址。现在先用服务器 IP，有域名后只改这一行。
                      链接格式：<postLinkBase>/#/post/<id>。留空时：网页版用当前页面地址，
                      App 里退回 NOVA_API_BASE，再没有就用 vexo://post/<id>。
   reverseGeocodeUrl  把坐标换成地名的服务地址（GET ?lat=..&lng=..，返回 {name:"上海市 黄浦区"}）。
                      留空 = 不换地名，只填坐标，用户可以自己改。服务器端实现见 docs/r7-server-notes.md。 */
const NOVA_CFG={
  postLinkBase:'https://47.239.0.90',
  reverseGeocodeUrl:''
};
try{
  if(typeof window!=='undefined'){
    if(window.NOVA_POST_LINK_BASE)NOVA_CFG.postLinkBase=String(window.NOVA_POST_LINK_BASE);
    if(window.NOVA_REVERSE_GEOCODE_URL)NOVA_CFG.reverseGeocodeUrl=String(window.NOVA_REVERSE_GEOCODE_URL);
  }
}catch(e){}
