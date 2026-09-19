export function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
export function getErrorMessage(e){if(!e)return"Неизвестная ошибка";if(typeof e==="string")return e;return e.message||e.error_msg||e.error?.error_msg||String(e);}
export function logError(t,e){console.error(t,e);}
export function getBestPhotoUrl(p){if(!Array.isArray(p?.sizes))return"";const a=[...p.sizes].filter(x=>x?.url).sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));return a[0]?.url||"";}
export function getAlbumCover(a){const s=[...(Array.isArray(a?.sizes)?a.sizes:[]),...(Array.isArray(a?.thumb?.sizes)?a.thumb.sizes:[])].filter(x=>x&&(x.src||x.url)).sort((a,b)=>(b.width||0)*(b.height||0)-(a.width||0)*(a.height||0));return s[0]?.src||s[0]?.url||"";}
