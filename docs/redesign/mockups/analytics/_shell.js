/* Injects the operator shell chrome + KPI rail so the 3 layout pages stay DRY */
function railHTML(){
  const items=[['home','Overview'],['cal','Bookings'],['users','Customers'],['spray','Cleaners'],['tag','Services'],['card','Payments'],['bar','Analytics',true],['msg','Messages'],['gear','Settings']];
  return `<aside class="rail"><div class="mark">N</div>`+
    items.map(([ic,l,on])=>`<div class="ico ${on?'on':''}" title="${l}" data-ico="${ic}"></div>`).join('')+`</aside>`;
}
function topbarHTML(){
  return `<div class="topbar">
    <div class="search"><span data-ico="search" style="width:16px;height:16px;display:flex"></span>Search bookings, customers…</div>
    <div class="spacer"></div>
    <div class="pill" data-ico="bell"></div>
    <button class="new"><span data-ico="plus" style="width:16px;height:16px;display:flex"></span>New booking</button>
    <div class="avatar">BR</div>
  </div>`;
}
function kpiRailHTML(){
  const k=[
    ['Revenue collected','$48.2k','up','&#9650; 12%','dollar','30,33,31,36,38,42,44,48','#1FAE63'],
    ['Booked pipeline','$61.0k','up','&#9650; 5%','cal','44,46,45,49,52,55,58,61','#0150FC'],
    ['Jobs completed','132','flat','94% of 140','check','100,108,112,118,121,126,129,132','#857C70'],
    ['Recurring share','58%','up','&#9650; 6 pts','repeat','48,50,51,53,54,55,57,58','#0150FC'],
    ['Cancel rate','4.2%','good-down','&#9660; 0.6 pts','xc','6.1,5.7,5.4,5.0,4.8,4.6,4.4,4.2','#1FAE63'],
    ['Avg job value','$148','up','&#9650; 3%','trend','138,140,139,143,145,144,146,148','#0150FC'],
  ];
  return `<div class="grid kpis mb">`+k.map(([l,v,t,d,ic,sp,col])=>
    `<div class="kpi"><div class="top"><span class="lab">${l}</span><span class="ic" data-ico="${ic}"></span></div>
     <div class="val tnum">${v}</div>
     <div class="foot"><span class="delta ${t}">${d}</span><span data-spark="${sp}" data-color="${col}"></span></div></div>`
  ).join('')+`</div>`;
}
function insightsHTML(){
  const ins=[
    ['pos','trend','<b>Revenue up 12%</b> vs the previous 30 days, driven mostly by <b>Deep cleans</b> (+$1.4k).'],
    ['warn','alert','<b>No-shows cluster on Tuesdays.</b> 9 of 18 cancellations were Tue customer flakes, this period.'],
    ['brand','repeat','<b>Recurring base is growing</b> — 58% of revenue is now repeat work, up 6 points.'],
    ['crit','users','<b>12 regulars went quiet.</b> No booking in 30+ days. Worth a win-back nudge.'],
  ];
  return `<div class="insights">`+ins.map(([tone,ic,tx])=>
    `<div class="ins"><span class="b ${tone}" data-ico="${ic}"></span><span class="tx">${tx}</span></div>`
  ).join('')+`</div>`;
}
function mountShell(contentHTML){
  document.getElementById('root').innerHTML =
    `<div class="app">${railHTML()}<div class="main">${topbarHTML()}<div class="content">${contentHTML}</div></div></div>`;
}
