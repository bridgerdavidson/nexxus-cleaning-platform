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
 * entry cannot set arbitrary CSS.
 */
export const BRAND_BOOTSTRAP_SCRIPT = `
(function(){try{
var raw=localStorage.getItem(${JSON.stringify(BRAND_CACHE_KEY)});
if(!raw)return;
var v=JSON.parse(raw).vars;
if(!v)return;
var s=document.documentElement.style;
for(var k in v){if(k.indexOf("--brand-")===0){s.setProperty(k,v[k]);}}
}catch(e){}})();
`;
