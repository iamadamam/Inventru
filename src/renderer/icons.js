'use strict';
/* Built-in line icons (24x24, stroke). No external files or fonts, so nothing is downloaded. */

const ICON_PATHS = {
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  laptop: '<rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M2 19h20"/>',
  pc: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 6h4M10 10h4M12 17h.01"/>',
  dock: '<rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 13h2M11 13h2M17 13h.01"/>',
  cable: '<path d="M7 2v4M11 2v4M5 6h8v4a4 4 0 0 1-8 0zM9 14v3a4 4 0 0 0 4 4h1a4 4 0 0 0 4-4V8"/>',
  usb: '<path d="M12 2v15M9 5l3-3 3 3M7 10v2l5 3 5-3v-2"/><circle cx="12" cy="19.5" r="2"/>',
  power: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  headset: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  webcam: '<circle cx="12" cy="10" r="7"/><circle cx="12" cy="10" r="3"/><path d="M8 21h8M12 17v4"/>',
  speaker: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  tablet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 18h2"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2-8h10l2 8M17 16.5h.01"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01"/>',
  battery: '<rect x="2" y="7" width="18" height="10" rx="2"/><path d="M22 11v2M6 11v2"/>',
  bag: '<path d="M4 8h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8V5a3 3 0 0 1 6 0v3"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  ram: '<rect x="2" y="7" width="20" height="9" rx="1"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 16v3M19 16v3"/>',
  sdcard: '<path d="M7 2h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM9 6v3M12 6v3M15 6v3"/>',
  ethernet: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 19v-5h8v5M10 14v-3h4v3"/>',
  projector: '<rect x="2" y="8" width="20" height="9" rx="2"/><circle cx="16" cy="12.5" r="2.5"/><path d="M6 12h4M5 17v2M19 17v2"/>',
  tv: '<rect x="2" y="5" width="20" height="13" rx="2"/><path d="M7 2l5 3 5-3M8 21h8"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15 12h.01M17.5 14h.01"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4M12 10v2l1.5 1.5"/>',
  sim: '<path d="M6 2h9l4 4v16H6z"/><rect x="9" y="11" width="7" height="7" rx="1"/>',
  deskphone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  barcode: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  paper: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8"/>',
  pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  truck: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  recycle: '<path d="M7 19H4.8a1.8 1.8 0 0 1-1.6-2.7L7.1 10M11 19h8.2a1.8 1.8 0 0 0 1.6-2.7l-1.2-2M14 16l-3 3 3 3M8.3 13.6L7.1 10 3.5 11M9.3 5.6l1.2-2a1.8 1.8 0 0 1 3.1 0l4.1 6.8M14.9 9.4l3.6 1 1-3.6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  collapse: '<path d="M17 11l-5-5-5 5M17 18l-5-5-5 5"/>',
  expand: '<path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>',
  // UI
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10.7 10.7 0 0 1 12 20C5 20 1 12 1 12a18 18 0 0 1 5.1-5.9M9.9 4.2A10 10 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2M1 1l22 22"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  cloud: '<path d="M17.5 19H7a5 5 0 1 1 1.1-9.9A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19z"/>',
  pc2: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
};

/** Item icons offered in the picker (keys of ICON_PATHS). */
const ITEM_ICONS = ['mouse', 'keyboard', 'monitor', 'laptop', 'pc', 'server', 'tablet', 'phone', 'deskphone', 'watch',
  'dock', 'cable', 'ethernet', 'usb', 'power', 'battery', 'headset', 'mic', 'webcam', 'speaker', 'projector', 'tv', 'gamepad',
  'printer', 'barcode', 'drive', 'sdcard', 'ram', 'chip', 'sim', 'wifi', 'key', 'lock', 'shield', 'bulb',
  'paper', 'pen', 'clipboard', 'bag', 'tools', 'archive', 'box', 'cart', 'truck', 'recycle', 'tag', 'star', 'heart'];

/** First match wins, so more specific words come first ("USB headset" -> headset, "USB-C dock" -> dock). */
const ICON_RULES = [
  [/server|\bnas\b|\brack\b/i, 'server'],
  [/\b(ram|dimm|so-?dimm|ddr\d?)\b/i, 'ram'],
  [/\bcpu\b|processor/i, 'chip'],
  [/\bsd\b|micro ?sd|memory card/i, 'sdcard'],
  [/ethernet|\brj-?45\b|patch|cat ?[56]/i, 'ethernet'],
  [/projector/i, 'projector'],
  [/\btv\b|television/i, 'tv'],
  [/microphone|\bmic\b/i, 'mic'],
  [/controller|gamepad|joystick/i, 'gamepad'],
  [/smart ?watch|\bwatch\b/i, 'watch'],
  [/\bsim\b/i, 'sim'],
  [/desk ?phone|voip|polycom/i, 'deskphone'],
  [/barcode|label printer/i, 'barcode'],
  [/\bkeys?\b|fob/i, 'key'],
  [/\block\b|padlock|kensington/i, 'lock'],
  [/paper|\ba4\b|envelope/i, 'paper'],
  [/\bpens?\b|marker|pencil/i, 'pen'],
  [/head(set|phone)|ear(phone|bud)/i, 'headset'],
  [/web ?cam|camera/i, 'webcam'],
  [/keyboard/i, 'keyboard'],
  [/\bmice\b|mouse/i, 'mouse'],
  [/monitor|screen|display(?!port)/i, 'monitor'],
  [/laptop|notebook|macbook|chromebook|ultrabook/i, 'laptop'],
  [/dock|\bhub\b/i, 'dock'],
  [/printer|toner|scanner|\bink\b/i, 'printer'],
  [/phone|mobile|iphone|android|handset/i, 'phone'],
  [/tablet|ipad|surface go/i, 'tablet'],
  [/\b(ssd|hdd|nvme)\b|hard ?drive|storage|disk/i, 'drive'],
  [/charger|power|psu|adapter|plug/i, 'power'],
  [/cable|hdmi|displayport|\bdp\b|vga|lead|cord|patch/i, 'cable'],
  [/usb|flash|stick|dongle|memory/i, 'usb'],
  [/speaker|audio|sound/i, 'speaker'],
  [/router|switch|wi-?fi|network|access point|firewall/i, 'wifi'],
  [/desktop|\bpc\b|tower|computer|workstation|thin client/i, 'pc'],
  [/batter/i, 'battery'],
  [/\bbag|case|sleeve|backpack/i, 'bag'],
  [/tool|kit|screwdriver/i, 'tools'],
];

function guessIcon(...texts) {
  for (const t of texts) {
    if (!t) continue;
    for (const [re, icon] of ICON_RULES) if (re.test(t)) return icon;
  }
  return null;
}

function svgIcon(name, extra = '') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${ICON_PATHS[name] || ICON_PATHS.box}</svg>`;
}

/** Custom (user-added) icons: set by app.js from state.customIcons. Keys start with "c_". */
let CUSTOM_ICONS = new Map();
const SAFE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Markup for any icon key: a built-in name or a custom "c_..." id. */
function iconMarkup(key) {
  if (key && key.startsWith('c_')) {
    const c = CUSTOM_ICONS.get(key);
    if (c && SAFE_DATA_URL.test(c.data)) return `<img src="${c.data}" alt="" draggable="false">`;
    return svgIcon('box');
  }
  return svgIcon(key);
}
