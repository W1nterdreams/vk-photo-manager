const P="vk-photo-manager:";
export function cacheSet(k,v){localStorage.setItem(P+k,JSON.stringify({savedAt:Date.now(),value:v}));}
export function cacheGet(k,maxAge){try{const d=JSON.parse(localStorage.getItem(P+k));if(!d)return null;if(maxAge&&Date.now()-d.savedAt>maxAge)return null;return d.value;}catch{return null;}}
export function cacheRemove(k){localStorage.removeItem(P+k);}
// Следующий этап: альбомы 5 мин; фото 10 мин; комментарии 10 мин; комментарии только за последние 10 суток.
