// Dev-only HUD + Settings preview (client/hud-preview.html). Not part of the production build.
import '../tokens.css';
import { Hud } from '../Hud';
import { SettingsPanel, type SettingsTab } from '../SettingsPanel';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'hud';
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

// fake bright low-poly world
const world = document.getElementById('world')!;
world.style.cssText =
  'position:fixed;inset:0;background:' +
  'linear-gradient(160deg,transparent 60%,rgba(255,255,255,.12) 60% 64%,transparent 64%),' +
  'linear-gradient(180deg,#7fc0ff 0%,#bfe0ff 46%,#e9e2c9 52%,#9cc27a 53%,#7ea85c 75%,#6b9150 100%)';
const poly = (css: string, color: string) => {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;background:${color};${css}`;
  world.append(d);
};
poly('left:4%;bottom:38%;width:30%;height:26%;clip-path:polygon(0 100%,40% 10%,58% 40%,75% 0,100% 100%)', '#8aa0b8');
poly('right:6%;bottom:40%;width:26%;height:30%;clip-path:polygon(0 100%,30% 20%,55% 55%,80% 5%,100% 100%)', '#9fb2c6');
poly('left:22%;bottom:24%;width:14%;height:30%;clip-path:polygon(10% 100%,10% 30%,50% 0,90% 30%,90% 100%)', '#e8d2a6');
poly('left:62%;bottom:20%;width:10%;height:36%;clip-path:polygon(0 100%,0 0,100% 0,100% 100%)', '#d98b5f');
poly('left:44%;bottom:30%;width:6%;height:22%;clip-path:polygon(0 100%,0 15%,50% 0,100% 15%,100% 100%)', '#f2f2f2');

if (view === 'hud' || view === 'both') {
  const hud = new Hud(document.body);
  (window as unknown as { hud: Hud }).hud = hud;
  hud.holdHitmarker = true;
  hud.setHealth(num('hp', 34));
  const melee = q.get('melee') === '1';
  hud.setWeapon(
    melee
      ? { name: 'Crowbar of Regret', tier: 3, tierLabel: 'Rare', melee: { swing: 'Overhead' } }
      : { name: 'Banana Sniper MK-II', tier: 4, tierLabel: 'Prototype', melee: null },
  );
  const reload = q.get('reload') === '1';
  hud.setAmmo(melee ? Infinity : q.get('empty') === '1' ? 0 : num('ammo', 7), 30, reload);
  hud.setReloadProgress(reload ? 0.62 : null);
  hud.setNetMicro(num('ping', 23), 144);
  hud.addKill('Kaboomer', 'Thunder Kazoo', 'Pixel_Pete', false, { tier: 2 });
  hud.addKill('You', 'Banana Sniper MK-II', 'xX_Noscope_Xx', true, { tier: 4, killerIsYou: true });
  hud.addKill('Grandma Gatling', 'Hyper Sock Launcher of the Endless Void', 'Mudkip', false, { tier: 5 });
  hud.addKill('Sir Slashalot', 'Crowbar of Regret', 'You', false, { tier: 3, melee: true, victimIsYou: true });
  hud.damageFrom('a', -0.9);
  hud.damageFrom('b', 2.6);
  hud.hitMarker(q.get('kill') === '1', true);
  if (q.get('kill') === '1') hud.killConfirm(true);
  hud.setCharge(melee ? 1 : 0);
  hud.setStatus(q.get('status') ?? 'Sprinting');
  if (q.get('toast') !== '0' && view !== 'both')
    hud.toast('Weapon forged: <b>Banana Sniper MK-II</b> is ready.', { type: 'forge', ms: 1e9, action: { label: 'Equip', onClick: () => {} } });
  if (q.get('toasts') === '2') hud.toast('Connection restored.', { type: 'success', ms: 1e9 });
  if (q.get('debug') === '1') hud.setDebug('pos 12.3 4.0 -8.1\nvel 0.0 0.0 0.0\nstate grounded');
  hud.setScoreboardRows(
    [
      { id: '1', name: 'Grandma Gatling', weapon: 'Hyper Sock Launcher of the Endless Void', tier: 5, kills: 14, deaths: 3, hsPct: 41, ping: 32, you: false, alive: true },
      { id: '2', name: 'You', weapon: 'Banana Sniper MK-II', tier: 4, kills: 11, deaths: 5, hsPct: 63, ping: 23, you: true, alive: true },
      { id: '3', name: 'Sir Slashalot', weapon: 'Crowbar of Regret', tier: 3, kills: 9, deaths: 7, hsPct: null, ping: 96, you: false, alive: false },
      { id: '4', name: 'Kaboomer', weapon: 'Thunder Kazoo', tier: 2, kills: 6, deaths: 9, hsPct: 12, ping: 178, you: false, alive: true },
      { id: '5', name: 'Pixel_Pete', weapon: 'Rusty Pistol', tier: 1, kills: 2, deaths: 12, hsPct: 8, ping: null, you: false, alive: true },
    ],
    'ai-gaem · EU-1 · 5 players online',
  );
  hud.forceScoreboard = q.get('sb') === '1';
  hud.update(0.2); // status line delay
  hud.update(0); // status line settles
  if (q.get('live') === '1') {
    let last = performance.now();
    const loop = (t: number) => {
      hud.update((t - last) / 1000);
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

if (view === 'settings' || view === 'both') {
  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;top:0;bottom:0;right:0;left:min(440px,30vw);z-index:50;padding:48px 56px 32px;' +
    'background:rgba(11,13,18,.88);backdrop-filter:blur(8px);display:flex;flex-direction:column;';
  const title = document.createElement('h2');
  title.className = 'ui-title';
  title.textContent = 'Settings';
  title.style.marginBottom = '20px';
  const panel = new SettingsPanel();
  panel.selectTab((q.get('tab') as SettingsTab) ?? 'controls');
  host.append(title, panel.root);
  panel.root.style.flex = '1';
  panel.root.style.minHeight = '0';
  document.body.append(host);
}
