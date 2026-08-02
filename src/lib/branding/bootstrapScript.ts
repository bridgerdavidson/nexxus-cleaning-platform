import { BRAND_CACHE_KEY, REMEMBERED_ORG_KEY, BRAND_BOOTSTRAP_SHEET_GLOBAL } from "./tokens";
import { BRANDED_APP_PREFIXES } from "./paths";

/**
 * Runs before hydration, from an inline <script> at the top of <body>.
 *
 * Without it every cold load paints the default Nexxus blue and then snaps to
 * the tenant's color, because each role layout renders FullPageLoader while
 * orgStatus === "loading", i.e. before the org is known. Same mechanism the
 * queued dark-mode work needs. See docs/white-label-branding.md decision 6.
 *
 * Delivery is a CONSTRUCTED stylesheet (document.adoptedStyleSheets), never a
 * DOM mutation: React 19 hydrates the whole document, and both a pre-hydration
 * style attribute on <html> and a foreign <style> tag in <head> trigger
 * hydration mismatch #418 (verified empirically; suppressHydrationWarning
 * covers neither), whose recovery can wipe the replayed ramp mid-load.
 * Adopted sheets sit outside the DOM, cascade after document stylesheets (so
 * the replayed :root vars beat globals.css), and are ignored by hydration.
 * BrandProvider un-adopts the sheet via the window handle whenever it
 * restores the default palette; its own inline vars, set once the real org
 * row arrives, take precedence over the sheet. Browsers without constructed
 * stylesheets (pre-2023) just skip the replay and briefly flash the default.
 *
 * Guards, in order:
 * - Only tenant app paths (BRANDED_APP_PREFIXES): marketing, /login, /signup,
 *   and /owner stay Nexxus even for a signed-in visitor (BrandProvider
 *   applies the same gate after hydration).
 * - Only variables namespaced "--brand-", with values stripped to a safe
 *   character set, so a tampered cache entry cannot inject CSS.
 * - Skips the replay when the remembered org (nexxus.currentOrg) differs from
 *   the cache's orgId, so an org switch never paints the OLD company's ramp.
 */
export const BRAND_BOOTSTRAP_SCRIPT = `
(function(){try{
var pfx=${JSON.stringify(BRANDED_APP_PREFIXES)};
var path=location.pathname;
var ok=false;
for(var i=0;i<pfx.length;i++){if(path===pfx[i]||path.indexOf(pfx[i]+"/")===0){ok=true;break;}}
if(!ok)return;
var raw=localStorage.getItem(${JSON.stringify(BRAND_CACHE_KEY)});
if(!raw)return;
var p=JSON.parse(raw);
var v=p.vars;
if(!v)return;
var remembered=null;
try{remembered=localStorage.getItem(${JSON.stringify(REMEMBERED_ORG_KEY)});}catch(e){}
if(remembered&&p.orgId&&remembered!==p.orgId)return;
var css="";
for(var k in v){if(k.indexOf("--brand-")===0){css+=k+":"+String(v[k]).replace(/[^0-9a-zA-Z%., -]/g,"")+";";}}
if(!css)return;
var sheet=new CSSStyleSheet();
sheet.replaceSync(":root{"+css+"}");
document.adoptedStyleSheets=document.adoptedStyleSheets.concat(sheet);
window[${JSON.stringify(BRAND_BOOTSTRAP_SHEET_GLOBAL)}]=sheet;
}catch(e){}})();
`;
