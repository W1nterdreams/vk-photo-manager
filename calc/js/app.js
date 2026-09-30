(function(){
  'use strict';
  const D=window.MANIA_DATA,P=window.ManiaParser;
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const state={garmentId:'women_pullover',sizeIndex:3,gauge:20,meters:1400,weight:100,plies:2,last:null,catalog:[]};
  const els={garmentGrid:$('#garmentGrid'),sizeChips:$('#sizeChips'),sizeHint:$('#sizeHint'),gaugeRange:$('#gaugeRange'),gaugeInput:$('#gaugeInput'),gaugeHint:$('#gaugeHint'),yarnMeters:$('#yarnMeters'),yarnWeight:$('#yarnWeight'),pliesChips:$('#pliesChips'),validation:$('#validation'),resultCard:$('#resultCard'),resultTitle:$('#resultTitle'),resultGrams:$('#resultGrams'),resultMeters:$('#resultMeters'),resultEffective:$('#resultEffective'),resultRawGrams:$('#resultRawGrams'),resultReserve:$('#resultReserve'),resultNote:$('#resultNote'),compatBadge:$('#compatBadge'),matchEmpty:$('#matchEmpty'),matchContent:$('#matchContent'),matchSummary:$('#matchSummary'),matchGrid:$('#matchGrid'),descriptionInput:$('#descriptionInput'),parsedPreview:$('#parsedPreview'),catalogGrid:$('#catalogGrid'),catalogCount:$('#catalogCount'),vkState:$('#vkState')};
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function icon(name){return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`}
  function garment(){return D.garments.find(x=>x.id===state.garmentId)||D.garments[0]}
  function renderGarments(){els.garmentGrid.innerHTML=D.garments.map(g=>`<button type="button" class="garment-card${g.id===state.garmentId?' is-active':''}" data-id="${g.id}">${g.child?'<span class="child-badge">дет.</span>':''}${icon(g.icon)}<span>${g.name}</span></button>`).join('');}
  function renderSizes(){const g=garment();state.sizeIndex=clamp(state.sizeIndex,0,g.sizes.length-1);els.sizeHint.textContent=`${g.name}: выберите размер или формат.`;els.sizeChips.innerHTML=g.sizes.map((s,i)=>`<button type="button" class="chip${i===state.sizeIndex?' is-active':''}" data-i="${i}">${s.label}</button>`).join('');}
  function renderPlies(){els.pliesChips.innerHTML=[1,2,3,4,5,6,8,10].map(n=>`<button type="button" class="chip${n===state.plies?' is-active':''}" data-p="${n}">${n} ${n===1?'нить':n<5?'нити':'нитей'}</button>`).join('');}
  function gaugeRange(){const g=Math.round(clamp(Number(state.gauge)||20,8,30));return D.meterRanges[g]||D.meterRanges[20]}
  function renderGaugeHint(){const [a,b]=gaugeRange();els.gaugeHint.textContent=`Обычно такой плотности соответствует готовая нить примерно ${a}–${b} м/100 г.`;}
  function syncGauge(v){state.gauge=Math.round(clamp(Number(v)||20,8,30));els.gaugeRange.value=state.gauge;els.gaugeInput.value=state.gauge;renderGaugeHint();}
  function compute(){
    const g=garment(),size=g.sizes[state.sizeIndex]; const gauge=Math.round(clamp(Number(els.gaugeInput.value)||20,8,30)); const meters=Number(els.yarnMeters.value),weight=Number(els.yarnWeight.value); const plies=state.plies;
    if(!size||!Number.isFinite(meters)||meters<=0||!Number.isFinite(weight)||weight<=0){els.validation.textContent='Проверьте размер и метраж пряжи.';return null}
    els.validation.textContent=''; state.gauge=gauge;state.meters=meters;state.weight=weight;
    const mult=D.gaugeMultipliers[gauge]||1; const requiredMeters=Math.round(size.base*mult); const sourcePer100=meters/weight*100; const effective=sourcePer100/plies; const rawGrams=requiredMeters/effective*100; const reserveGrams=rawGrams*(1+D.reserve); const [min,max]=gaugeRange(); const middle=(min+max)/2; const deviation=Math.abs(effective-middle)/middle;
    const compat=effective>=min*.85&&effective<=max*1.15?'good':effective>=min*.65&&effective<=max*1.4?'warn':'bad';
    state.last={garment:g,size,gauge,requiredMeters,sourcePer100,effective,rawGrams,reserveGrams,compat,range:[min,max],plies};return state.last;
  }
  function showResult(r){
    els.resultCard.hidden=false;els.resultTitle.textContent=`${r.garment.name} · ${r.size.label}`;els.resultGrams.textContent=fmt(Math.ceil(r.reserveGrams/5)*5);els.resultMeters.textContent=`≈ ${fmt(r.requiredMeters)} м`;els.resultEffective.textContent=`≈ ${fmt(r.effective)} м/100 г`;els.resultRawGrams.textContent=`≈ ${fmt(r.rawGrams)} г`;els.resultReserve.textContent=`${Math.round(D.reserve*100)}%`;
    const labels={good:['Метраж подходит','good'],warn:['Пограничный метраж','warn'],bad:['Метраж сильно отличается','bad']};els.compatBadge.textContent=labels[r.compat][0];els.compatBadge.className='compat-badge '+labels[r.compat][1];
    els.resultNote.textContent=`При плотности ${r.gauge} п./10 см ориентир по толщине — ${r.range[0]}–${r.range[1]} м/100 г готовой нити. Ваш вариант в ${r.plies} слож. даёт около ${fmt(r.effective)} м/100 г. Итоговая посадка всё равно зависит от образца, узора и техники вязания.`;
    renderMatches();
  }
  function switchView(name){$$('.tab').forEach(b=>b.classList.toggle('is-active',b.dataset.view===name));$$('.view').forEach(v=>v.classList.toggle('is-active',v.id==='view-'+name));window.scrollTo({top:0,behavior:'smooth'});}
  function materialText(c){return c&&c.length?c.map(x=>`${x.percent}% ${x.material}`).join(', '):'состав не распознан'}
  function productTitle(p){return [p.brand,p.name].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')||'Пряжа'}
  function productCard(p,mode='catalog',match=null){
    const m=p.meterage;const meta=[p.country,p.color].filter(Boolean).join(' · ');let tags=[];if(m)tags.push(`${fmt(m.metersPer100g)} м/100 г`);if(p.composition.length)tags.push(materialText(p.composition));if(p.properties.length)tags.push(...p.properties);
    let stats='';if(mode==='match'&&match){stats=`<div class="product-stats"><div><span>Лучшее сложение</span><b>${match.plies}</b></div><div><span>Рабочий метраж</span><b>${fmt(match.effective)} м/100 г</b></div><div><span>Нужно с запасом</span><b>${fmt(match.needGrams)} г</b></div><div><span>Наличие</span><b>${p.stockGrams==null?'не указано':fmt(p.stockGrams)+' г'}</b></div>${p.pricePer100g?`<div><span>Ориентир цены</span><b>≈ ${fmt(match.needGrams/100*p.pricePer100g)} ₽</b></div>`:''}</div>`}
    const action=p.photoUrl?`<button class="card-action" data-open="${encodeURIComponent(p.photoUrl)}">Открыть фото VK</button>`:`<button class="card-action" disabled>Фото VK не привязано</button>`;
    return `<article class="product-card"><div class="product-card-top"><div class="yarn-swatch"></div><div><h3>${escapeHtml(productTitle(p))}</h3><div class="meta">${escapeHtml(meta||'Описание из каталога')}</div></div></div><div class="tag-row">${tags.slice(0,5).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}${p.stockGrams!=null?`<span class="tag good">в наличии ${fmt(p.stockGrams)} г</span>`:''}</div>${stats}${action}</article>`;
  }
  function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
  function initCatalog(){
    try{const saved=JSON.parse(localStorage.getItem('mania_yarn_catalog')||'null');if(Array.isArray(saved)&&saved.length)state.catalog=saved;else state.catalog=D.sampleDescriptions.map((t,i)=>P.parseDescription(t,{id:'sample-'+i}));}catch(_){state.catalog=D.sampleDescriptions.map((t,i)=>P.parseDescription(t,{id:'sample-'+i}));}
    renderCatalog();
  }
  function saveCatalog(){try{localStorage.setItem('mania_yarn_catalog',JSON.stringify(state.catalog))}catch(_){}}
  function renderCatalog(){els.catalogCount.textContent=`${state.catalog.length} поз.`;els.catalogGrid.innerHTML=state.catalog.map(p=>productCard(p)).join('')||'<p>Каталог пуст.</p>';}
  function scoreProduct(p,target){if(!p.meterage)return null;let best=null;for(let plies=1;plies<=12;plies++){const eff=p.meterage.metersPer100g/plies;const d=Math.abs(Math.log(eff/target));if(!best||d<best.distance)best={plies,effective:eff,distance:d}}return best;}
  function renderMatches(){
    const r=state.last;if(!r){els.matchEmpty.hidden=false;els.matchContent.hidden=true;return}els.matchEmpty.hidden=true;els.matchContent.hidden=false;els.matchSummary.innerHTML=`<div class="mini-orb">${icon('yarn')}</div><div><h3>${escapeHtml(r.garment.name)} · ${escapeHtml(r.size.label)}</h3><p>Нужно ≈ ${fmt(r.requiredMeters)} м готовой нити. Ориентир по рабочему метражу: ${r.range[0]}–${r.range[1]} м/100 г.</p></div>`;
    const target=(r.range[0]+r.range[1])/2;const rows=state.catalog.map(p=>{const b=scoreProduct(p,target);if(!b)return null;const needRaw=r.requiredMeters/b.effective*100;const need= Math.ceil(needRaw*(1+D.reserve)/5)*5; const stockPenalty=p.stockGrams!=null&&p.stockGrams<need?0.35:0;return{p,b:{...b,needGrams:need},score:b.distance+stockPenalty}}).filter(Boolean).sort((a,b)=>a.score-b.score).slice(0,8);
    els.matchGrid.innerHTML=rows.length?rows.map(x=>productCard(x.p,'match',x.b)).join(''):'<div class="empty-state"><h3>Нет распознанного метража</h3><p>Добавьте в каталог описания, где указан метраж пряжи.</p></div>';
  }
  function previewParsed(p){const fields=[['Название',productTitle(p)],['Страна',p.country],['Цвет',p.color],['Метраж',p.meterage?`${p.meterage.metersPer100g} м/100 г`:null],['Номер',p.yarnCount],['Состав',materialText(p.composition)],['Остаток',p.stockGrams!=null?`${p.stockGrams} г`:null],['Цена',p.pricePer100g!=null?`${p.pricePer100g} ₽/100 г`:null],['Свойства',p.properties.join(', ')||null]];els.parsedPreview.innerHTML=`<div class="parsed-grid">${fields.map(([k,v])=>`<div class="parsed-field"><span>${k}</span><b>${escapeHtml(v??'не найдено')}</b></div>`).join('')}</div>`;els.parsedPreview._data=p;}
  function copyResult(){if(!state.last)return;const r=state.last;const text=`Мания пряжи — расчёт\n${r.garment.name}, ${r.size.label}\nПлотность: ${r.gauge} п./10 см\nНужно: ≈ ${fmt(r.requiredMeters)} м\nПряжа: ${fmt(state.meters)} м / ${fmt(state.weight)} г, ${r.plies} слож.\nРабочий метраж: ≈ ${fmt(r.effective)} м/100 г\nРекомендуемый вес с запасом: ≈ ${fmt(Math.ceil(r.reserveGrams/5)*5)} г`;
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(text).then(()=>toast('Результат скопирован')).catch(()=>fallbackCopy(text));else fallbackCopy(text);
  }
  function fallbackCopy(text){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast('Результат скопирован')}catch(_){toast('Не удалось скопировать')}ta.remove();}
  function toast(msg){els.validation.textContent=msg;setTimeout(()=>{if(els.validation.textContent===msg)els.validation.textContent=''},1800)}
  function initVK(){
    if(!window.vkBridge){els.vkState.querySelector('span:last-child').textContent='Web';return}
    try{window.vkBridge.send('VKWebAppInit').then(()=>{els.vkState.classList.add('is-vk');els.vkState.querySelector('span:last-child').textContent='VK';}).catch(()=>{});window.vkBridge.subscribe(e=>{if(e&&e.detail&&e.detail.type==='VKWebAppUpdateConfig'&&e.detail.data){const scheme=e.detail.data.scheme||'';document.documentElement.dataset.vkScheme=scheme;}});}catch(_){ }
  }
  els.garmentGrid.addEventListener('click',e=>{const b=e.target.closest('[data-id]');if(!b)return;state.garmentId=b.dataset.id;state.sizeIndex=Math.min(3,garment().sizes.length-1);renderGarments();renderSizes();els.resultCard.hidden=true;state.last=null;renderMatches();});
  els.sizeChips.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(!b)return;state.sizeIndex=Number(b.dataset.i);renderSizes();els.resultCard.hidden=true;state.last=null;renderMatches();});
  els.pliesChips.addEventListener('click',e=>{const b=e.target.closest('[data-p]');if(!b)return;state.plies=Number(b.dataset.p);renderPlies();});
  els.gaugeRange.addEventListener('input',e=>syncGauge(e.target.value));els.gaugeInput.addEventListener('input',e=>syncGauge(e.target.value));
  $('#calculateBtn').addEventListener('click',()=>{const r=compute();if(r)showResult(r)});$('#goMatchBtn').addEventListener('click',()=>switchView('match'));$('#copyBtn').addEventListener('click',copyResult);
  $$('.tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));$$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));
  $('#parseBtn').addEventListener('click',()=>previewParsed(P.parseDescription(els.descriptionInput.value)));
  $('#addCatalogBtn').addEventListener('click',()=>{const p=P.parseDescription(els.descriptionInput.value);state.catalog.unshift(p);saveCatalog();renderCatalog();previewParsed(p);renderMatches();toast('Добавлено в локальный каталог')});
  $('#resetCatalogBtn').addEventListener('click',()=>{state.catalog=D.sampleDescriptions.map((t,i)=>P.parseDescription(t,{id:'sample-'+i}));saveCatalog();renderCatalog();renderMatches();});
  document.addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(!b)return;const url=decodeURIComponent(b.dataset.open);window.open(url,'_blank','noopener,noreferrer');});
  renderGarments();renderSizes();renderPlies();renderGaugeHint();initCatalog();previewParsed(P.parseDescription(els.descriptionInput.value));renderMatches();initVK();
})();
