(function(){
  const aliases={
    'па':'полиамид','polyamide':'полиамид','nylon':'полиамид','полиамид':'полиамид',
    'wv':'шерсть','wool':'шерсть','шерсть':'шерсть',
    'меринос':'меринос','merino':'меринос','мериносовая шерсть':'меринос',
    'кашемир':'кашемир','cashmere':'кашемир',
    'альпака':'альпака','alpaca':'альпака',
    'беби верблюд':'беби верблюд','верблюд':'верблюд','camel':'верблюд',
    'мохер':'мохер','mohair':'мохер','ангора':'ангора','angora':'ангора',
    'хлопок':'хлопок','cotton':'хлопок','лен':'лён','лён':'лён','linen':'лён',
    'вискоза':'вискоза','viscose':'вискоза','шелк':'шёлк','шёлк':'шёлк','silk':'шёлк',
    'полиэстер':'полиэстер','polyester':'полиэстер','акрил':'акрил','acrylic':'акрил'
  };
  const knownBrands=['Cariaggi','Lanecardate','Biagioli Modesto','Loro Piana','Zegna Baruffa','Filpucci','Igea','Lineapiu','Lineapiù','Pecci Filati','Botto Giuseppe','Tollegno'];
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const num=s=>Number(String(s).replace(',','.'));
  function grams(value,unit){const v=num(value);return /кг/i.test(unit||'')?v*1000:v;}
  function normalizeMaterial(raw){
    const t=clean(raw).toLowerCase().replace(/^[\s:–—-]+|[\s:–—-]+$/g,'');
    const rules=[
      [/кашемир|cashmere/,'кашемир'],[/беби\s*верблюд/,'беби верблюд'],[/верблюд|camel/,'верблюд'],
      [/меринос|merino/,'меринос'],[/альпака|alpaca/,'альпака'],[/мохер|mohair/,'мохер'],[/ангора|angora/,'ангора'],
      [/полиамид|polyamide|nylon|(^|\s)па($|\s)/,'полиамид'],[/полиэстер|polyester/,'полиэстер'],[/акрил|acrylic/,'акрил'],
      [/хлопок|cotton/,'хлопок'],[/л[её]н|linen/,'лён'],[/вискоза|viscose/,'вискоза'],[/ш[её]лк|silk/,'шёлк'],[/шерсть|wool|(^|\s)wv($|\s)/,'шерсть']
    ];
    for(const [re,v] of rules){if(re.test(t))return v}return t;
  }
  function parseComposition(text){
    const items=[]; const re=/(\d{1,3}(?:[.,]\d+)?)\s*%\s*([^,.;]+)/gi; let m;
    while((m=re.exec(text))){let material=normalizeMaterial(m[2].replace(/\b(гребенн\w*|экстрафайн|superfine|extra\s*fine|с\s+пайетками)\b/gi,' '));if(material)items.push({percent:num(m[1]),material});}
    return items.filter((x,i,a)=>i===a.findIndex(y=>y.material===x.material&&y.percent===x.percent));
  }
  function parseMeterage(text){
    const patterns=[
      /(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм\w*)\s*[\/хx×\-–—:]?\s*(\d+(?:[.,]\d+)?)\s*(?:м|метр\w*)/i,
      /(\d+(?:[.,]\d+)?)\s*(?:м|метр\w*)\s*[\/хx×\-–—:]?\s*(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм\w*)/i
    ];
    let m=patterns[0].exec(text); if(m){const w=num(m[1]),meters=num(m[2]);if(w>0&&meters>0)return{meters,grams:w,metersPer100g:Math.round(meters/w*100)}}
    m=patterns[1].exec(text); if(m){const meters=num(m[1]),w=num(m[2]);if(w>0&&meters>0)return{meters,grams:w,metersPer100g:Math.round(meters/w*100)}}
    return null;
  }
  function parsePrice(text){
    let m=/(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм\w*)\s*[\/]\s*(\d+(?:[.,]\d+)?)\s*(?:руб(?:\.|лей)?|₽|р\.?)(?!\w)/i.exec(text);
    if(m){const basis=num(m[1]),price=num(m[2]);return{price,basisGrams:basis,pricePer100g:Math.round(price/basis*100)}}
    m=/(\d+(?:[.,]\d+)?)\s*(?:руб(?:\.|лей)?|₽|р\.?)\s*[\/]\s*(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм\w*)/i.exec(text);
    if(m){const price=num(m[1]),basis=num(m[2]);return{price,basisGrams:basis,pricePer100g:Math.round(price/basis*100)}}
    return null;
  }
  function parseStock(text){const m=/(?:в\s+наличии|остаток|осталось|есть)\s*[:\-–—]?\s*(\d+(?:[.,]\d+)?)\s*(кг|г|гр|грамм\w*)/i.exec(text);return m?Math.round(grams(m[1],m[2])):null;}
  function parseColor(text){
    let m=/\bCol\.?\s*([^\.]+?)(?=\.\s|$)/i.exec(text);if(m)return clean(m[1]);
    m=/(?:цвет|цвета)\s*[:\-–—]?\s*([^\.]+)/i.exec(text);return m?clean(m[1]):null;
  }
  function parseYarnCount(text){const matches=[...text.matchAll(/\((\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?)\)/g)];return matches.length?matches[0][1].replace(/\s/g,''):null;}
  function parseCountry(text){if(/италия/i.test(text))return 'Италия';return null;}
  function parseBrand(text){for(const b of knownBrands){if(new RegExp('(?:^|[.\\s])'+b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:[.\\s]|$)','i').test(text))return b}return null;}
  function parseName(text,brand){
    let m=/\bArt\.?\s*([^\.]+)/i.exec(text);if(m)return clean(m[1]);
    const chunks=text.split('.').map(clean).filter(Boolean);
    const skip=/^(италия|stock\s*yarn(?:\s*italy)?|цвет|col\b|в наличии|остаток|осталось)/i;
    for(const c of chunks){if(c===brand||skip.test(c)||/%/.test(c)||/\d+\s*г\s*\/\s*\d+\s*м/i.test(c)||/руб|₽/i.test(c))continue;if(c.length>2&&c.length<80)return c;}
    return brand||'Пряжа';
  }
  function parseDescription(text,extra={}){
    text=clean(text);const meterage=parseMeterage(text),price=parsePrice(text),brand=parseBrand(text);const composition=parseComposition(text);
    const properties=[];if(/пайетк/i.test(text))properties.push('пайетки');if(/экстрафайн|extra\s*fine/i.test(text))properties.push('экстрафайн');if(/гребенн/i.test(text))properties.push('гребенной');if(/моточн/i.test(text))properties.push('моточная');if(/бобин/i.test(text))properties.push('бобинная');
    const confidence={meterage:meterage?'high':'none',composition:composition.length?'high':'none',stock:parseStock(text)!=null?'high':'none',price:price?'high':'none'};
    return {id:extra.id||('local-'+Date.now()+'-'+Math.random().toString(36).slice(2,7)),photoUrl:extra.photoUrl||'',sourceText:text,country:parseCountry(text),brand,name:parseName(text,brand),color:parseColor(text),composition,properties,meterage,yarnCount:parseYarnCount(text),stockGrams:parseStock(text),pricePer100g:price?price.pricePer100g:null,confidence};
  }
  window.ManiaParser={parseDescription,parseMeterage,parseComposition};
})();
