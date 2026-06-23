/* Reusable mock chart kit — deterministic inline SVG/HTML, brand-themed */
const C = { brand:'#0150FC', brandSoft:'#9DBEFF', sky:'#3F9DF5', skySoft:'#BBDAFB',
  pos:'#1FAE63', caution:'#F59E0B', crit:'#E5484D', violet:'#7C5CFC',
  line:'#ECE7DF', grid:'#F0EBE3', ink:'#1A1714', muted:'#857C70' };

const I = {
  dollar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  xc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/></svg>',
  trend:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/></svg>',
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  bar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="13" y="7" width="3" height="10"/><rect x="18" y="13" width="2.5" height="4"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 11l5 4 5-4"/><path d="M5 21h14"/></svg>',
  spray:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h.01M7 5h.01M3 7h.01M9 3h.01M7 9h.01M3 11h.01"/><rect x="9" y="11" width="9" height="11" rx="2"/><path d="M14 11V7h4l2-4h-6"/></svg>',
  tag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h7l11 11-7 7L3 10z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
  card:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>',
  msg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.7 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 12.6H3a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6h.1A1.6 1.6 0 0 0 11 3a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17.3 5l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9.4A1.6 1.6 0 0 0 21 11h0a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
};

function sparkline(vals, color, w=92, h=30){
  const mn=Math.min(...vals), mx=Math.max(...vals), pad=2;
  const xs=(i)=> pad + i*((w-2*pad)/(vals.length-1));
  const ys=(v)=> h-pad - ((v-mn)/((mx-mn)||1))*(h-2*pad);
  const pts=vals.map((v,i)=>`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area=`${pad},${h-pad} ${pts} ${w-pad},${h-pad}`;
  const id='g'+Math.floor(Math.random()*1e6);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${area}" fill="url(#${id})"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${xs(vals.length-1).toFixed(1)}" cy="${ys(vals[vals.length-1]).toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
}

function heroChart(){
  const W=900,H=300, x0=46,x1=884,y0=255,y1=22, plotH=y0-y1;
  const wk=['Apr 28','May 5','May 12','May 19','May 26','Jun 2','Jun 9','Jun 16'];
  const real=[4.2,5.1,4.8,6.0,5.6,6.8,7.2,8.5];
  const pend=[1.0,0.9,1.4,1.1,1.8,1.5,2.1,2.6];
  const maxV=12, target=9;
  const xc=(i)=> x0 + 30 + i*((x1-x0-50)/(wk.length-1));
  const y=(v)=> y0 - (v/maxV)*plotH;
  const bw=40;
  let grid='', bars='', labels='';
  for(let g=0; g<=12; g+=3){ const yy=y(g); grid+=`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/><text x="${x0-8}" y="${yy+3.5}" text-anchor="end" font-size="10" fill="${C.muted}">$${g}k</text>`; }
  wk.forEach((w,i)=>{ const cx=xc(i); const rh=y0-y(real[i]); const ph=(y(real[i])-y(real[i]+pend[i]));
    bars+=`<rect x="${cx-bw/2}" y="${y(real[i]+pend[i])}" width="${bw}" height="${ph}" rx="3" fill="${C.skySoft}"/>`;
    bars+=`<rect x="${cx-bw/2}" y="${y(real[i])}" width="${bw}" height="${rh}" rx="3" fill="${C.brand}"/>`;
    labels+=`<text x="${cx}" y="${y0+17}" text-anchor="middle" font-size="9.5" fill="${C.muted}">${w}</text>`;
  });
  const totPts=wk.map((w,i)=>`${xc(i).toFixed(1)},${y(real[i]+pend[i]).toFixed(1)}`).join(' ');
  const tline=`<polyline points="${totPts}" fill="none" stroke="${C.brand}" stroke-width="2.4" stroke-dasharray="0" opacity=".0"/>`;
  const dots=wk.map((w,i)=>`<circle cx="${xc(i).toFixed(1)}" cy="${y(real[i]+pend[i]).toFixed(1)}" r="3" fill="#fff" stroke="${C.brand}" stroke-width="2"/>`).join('');
  const ty=y(target);
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" font-family="Plus Jakarta Sans">
    ${grid}
    <line x1="${x0}" y1="${ty}" x2="${x1}" y2="${ty}" stroke="${C.caution}" stroke-width="1.6" stroke-dasharray="5 5"/>
    <text x="${x1}" y="${ty-6}" text-anchor="end" font-size="10" font-weight="700" fill="${C.caution}">Weekly target $9k</text>
    ${bars}
    <polyline points="${totPts}" fill="none" stroke="${C.brand}" stroke-width="2.2" opacity=".55"/>
    ${dots}
    ${labels}
  </svg>`;
}

function donut(){
  const r=54, cx=70, cy=70, circ=2*Math.PI*r;
  const rec=0.58, one=1-rec;
  return `<div class="donut-wrap"><svg width="140" height="140" viewBox="0 0 140 140">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F1ECE4" stroke-width="18"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.brand}" stroke-width="18" stroke-linecap="round"
      stroke-dasharray="${(rec*circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy-2}" text-anchor="middle" font-size="26" font-weight="800" fill="${C.ink}">58%</text>
    <text x="${cx}" y="${cy+15}" text-anchor="middle" font-size="10.5" fill="${C.muted}" font-weight="600">recurring</text>
  </svg>
  <div class="legend">
    <div class="li"><span class="dot" style="background:${C.brand}"></span><span class="n">Recurring</span><span class="v">$27.9k</span></div>
    <div class="li"><span class="dot" style="background:#E4DED4"></span><span class="n">One-off</span><span class="v">$20.3k</span></div>
    <div class="li" style="margin-top:4px;font-size:11.5px;color:${C.muted}"><span style="color:${C.pos};font-weight:700">&#9650; 6 pts</span>&nbsp;more recurring vs last period</div>
  </div></div>`;
}

function runrate(){
  const hist=[31,33,32,36,38,37,41,44,46,48];
  const fc=[48,50,53,55];
  const W=320,H=96,pad=4;
  const all=[...hist,...fc.slice(1)]; const mn=Math.min(...all)-3, mx=Math.max(...all)+2;
  const N=hist.length+fc.length-1;
  const xs=(i)=> pad + i*((W-2*pad)/(N-1));
  const ys=(v)=> H-pad-((v-mn)/((mx-mn)||1))*(H-2*pad);
  const hp=hist.map((v,i)=>`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const fp=fc.map((v,i)=>`${xs(hist.length-1+i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area=`${pad},${H-pad} ${hp} ${xs(hist.length-1).toFixed(1)},${H-pad}`;
  return `<div class="rr"><div class="big tnum">$581k</div><div class="cap">Annualized run-rate &middot; trailing 30 days</div>
  <svg class="miniSpark" width="100%" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="rrg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.brand}" stop-opacity=".20"/><stop offset="1" stop-color="${C.brand}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#rrg)"/>
    <polyline points="${hp}" fill="none" stroke="${C.brand}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${fp}" fill="none" stroke="${C.brand}" stroke-width="2.4" stroke-dasharray="5 5" opacity=".6" stroke-linecap="round"/>
    <circle cx="${xs(hist.length-1).toFixed(1)}" cy="${ys(hist[hist.length-1]).toFixed(1)}" r="3" fill="${C.brand}"/>
  </svg>
  <div class="legend-inline"><span><i style="background:${C.brand}"></i>Actual</span><span><i style="background:${C.brandSoft}"></i>Forecast (booked)</span><span style="margin-left:auto;color:${C.pos};font-weight:800">On pace &#9650; 8%</span></div></div>`;
}

function heatmap(){
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hrs=['7','8','9','10','11','12','1','2','3','4','5','6'];
  // intensity 0..1 per [day][hr]
  const rows=[
    [.1,.3,.6,.8,.7,.5,.4,.6,.7,.5,.3,.1],
    [.1,.4,.7,.9,.8,.5,.4,.6,.8,.6,.3,.1],
    [.2,.3,.6,.7,.6,.4,.3,.5,.6,.5,.2,.1],
    [.1,.4,.7,.8,.7,.5,.4,.6,.7,.6,.4,.2],
    [.2,.5,.8,1,.9,.6,.5,.7,.9,.7,.4,.2],
    [.3,.6,.9,1,.8,.7,.6,.8,.7,.5,.3,.2],
    [.1,.2,.4,.5,.4,.3,.2,.3,.3,.2,.1,.05],
  ];
  let html='<div class="heat"><div></div>';
  hrs.forEach(h=> html+=`<div class="hh">${h}</div>`);
  rows.forEach((r,di)=>{ html+=`<div class="rl">${days[di]}</div>`;
    r.forEach(v=>{ const a=(0.06+v*0.94).toFixed(2); html+=`<div class="cell" style="background:rgba(1,80,252,${a})"></div>`; });
  });
  html+='</div><div class="legend-inline" style="margin-top:12px"><span>Quiet</span><span style="display:flex;gap:3px">'+
    [0.1,0.3,0.5,0.7,0.9,1].map(a=>`<i style="width:14px;height:10px;border-radius:3px;background:rgba(1,80,252,${a})"></i>`).join('')+
    '</span><span>Busy</span><span style="margin-left:auto;color:'+C.ink+';font-weight:700">Peak: Sat 10am</span></div>';
  return html;
}

function servicemix(){
  const items=[['Deep clean',5200,1],['Standard',4000,.77],['Move-out',3100,.6],['Recurring wk',2600,.5],['Add-ons',900,.17]];
  return '<div class="hbars">'+items.map(([n,v,f])=>
    `<div class="hbar"><div class="l"><span class="nm">${n}</span><span class="vl tnum">$${(v/1000).toFixed(1)}k</span></div><div class="track"><div class="fill" style="width:${f*100}%"></div></div></div>`
  ).join('')+'</div>';
}

function leaderboard(){
  const rows=[['Wanda P.','28 jobs · 4.9★',3584,1,'m1'],['Marco D.','22 jobs · 4.8★',2140,1.0*2140/3584,'m2'],['Lena R.','19 jobs · 5.0★',1920,1920/3584,'m3'],['Tariq S.','15 jobs · 4.7★',1510,1510/3584,'mn'],['Joy M.','12 jobs · 4.9★',1180,1180/3584,'mn']];
  return '<div class="lb">'+rows.map(([n,mt,amt,f,m],i)=>
    `<div class="row"><span class="medal ${m}">${i+1}</span><div class="who"><span class="nm">${n}</span><span class="mt">${mt}</span><span class="mini"><i style="width:${(f*100).toFixed(0)}%"></i></span></div><span class="amt tnum">$${amt.toLocaleString()}</span></div>`
  ).join('')+'</div>';
}

function cancellations(){
  const reasons=[['Customer flaked',38,C.crit],['Too far / routing',24,C.caution],['Cleaner sick',19,C.caution],['Invite expired',12,C.muted],['Other',7,C.muted]];
  const head=`<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px"><span class="tnum" style="font-size:26px;font-weight:800;color:${C.crit}">4.2%</span><span style="font-size:12px;color:${C.pos};font-weight:700">&#9660; 0.6 pts vs prev</span><span style="font-size:12px;color:${C.muted};margin-left:auto">18 of 432 jobs</span></div>`;
  const bars='<div class="hbars">'+reasons.map(([n,v,c])=>
    `<div class="hbar"><div class="l"><span class="nm">${n}</span><span class="vl tnum">${v}%</span></div><div class="track"><div class="fill" style="width:${v*2.2}%;background:${c}"></div></div></div>`
  ).join('')+'</div>';
  return head+bars;
}

function aging(){
  const b=[['Current',1820,C.pos,80],['1-7 days',1240,C.sky,56],['8-30 days',760,C.caution,36],['30+ days',410,C.crit,22]];
  return `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px"><span class="tnum" style="font-size:26px;font-weight:800">$4,230</span><span style="font-size:12px;color:${C.muted};font-weight:600">owed across 31 jobs</span></div><div class="aging">`+
    b.map(([n,v,c,h])=>`<div class="col"><span class="amt tnum" style="color:${c}">$${(v/1000).toFixed(1)}k</span><div class="bar" style="height:${h}%;background:${c}"></div><span class="cap">${n}</span></div>`).join('')+'</div>';
}

const CHARTS={ hero:heroChart, donut, runrate, heatmap, servicemix, leaderboard, cancellations, aging };

function render(){
  document.querySelectorAll('[data-chart]').forEach(el=>{ el.innerHTML=CHARTS[el.dataset.chart](); });
  document.querySelectorAll('[data-spark]').forEach(el=>{ const a=el.dataset.spark.split(',').map(Number); el.innerHTML=sparkline(a, el.dataset.color||C.brand); });
  document.querySelectorAll('[data-ico]').forEach(el=>{ el.innerHTML=I[el.dataset.ico]||''; });
}
document.addEventListener('DOMContentLoaded', render);
