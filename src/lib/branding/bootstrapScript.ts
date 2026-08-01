import { BRAND_CACHE_KEY } from "./tokens";

/**
 * Runs before hydration, from a <script> in <head>.
 *
 * Without it every cold load paints the default Nexxus blue and then snaps to
 * the tenant's color, because each role layout renders FullPageLoader while
 * orgStatus === "loading", i.e. before the org is known. Same mechanism the
 * queued dark-mode work needs. See docs/white-label-branding.md decision 6.
 *
 * Only writes variables whose names start with "--brand-", so a tampered cache
 * entry cannot set arbitrary CSS. Skips the replay when the remembered org
 * (nexxus.currentOrg) differs from the cache's orgId, so an org switch never
 * paints the OLD company's ramp while the new one loads.
 */
export const BRAND_BOOTSTRAP_SCRIPT = `
(function(){try{
var raw=localStorage.getItem(${JSON.stringify(BRAND_CACHE_KEY)});
if(!raw)return;
var p=JSON.parse(raw);
var v=p.vars;
if(!v)return;
var remembered=null;
try{remembered=localStorage.getItem("nexxus.currentOrg");}catch(e){}
if(remembered&&p.orgId&&remembered!==p.orgId)return;
var s=document.documentElement.style;
for(var k in v){if(k.indexOf("--brand-")===0){s.setProperty(k,v[k]);}}
}catch(e){}})();
`;
