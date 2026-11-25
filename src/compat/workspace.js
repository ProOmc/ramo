
'use strict';


const BASE_W=480,BASE_H=360;
const IDS={
 core:'ramo_core_base_v173',control:'ramo_control_base_v173',composerControl:'ramo_composer_control_v173',
 small:'ramo_small_control_v173',activity:'ramo_activity_size_v173',response:'ramo_response_size_v173',mode:'ramo_layout_mode_v173',page:'ramo_current_page_v180'
};
const NAV=['Attach Text','Memory Browser','Text Workspace','Info','Help','Voice Mode'];
const PAGE_TO_NAV={research:0,memory:1,files:2,archive:3,system:4};
const OC_DESIGN_CSS="/* Ramo Desktop 2.5 \u00b7 cohesive neutral visual language. Deliberately no navy/cyan theme. */\nhtml[data-ramo-theme=\"graphite\"] {\n --oc-bg:#242522;--oc-nav:#292a27;--oc-paper:#30312e;--oc-surface:#363731;\n --oc-field:#3b3c37;--oc-hover:#45473f;--oc-rule:rgba(229,228,216,.12);\n --oc-text:#f2f1e9;--oc-soft:#d6d5cb;--oc-muted:#a9aa9f;\n --oc-accent:#afbd90;--oc-accent-ink:#252820;--oc-focus:#b6c995;\n --oc-shadow:0 9px 26px rgba(0,0,0,.10);\n color-scheme:dark;\n}\nhtml[data-ramo-theme=\"paper\"] {\n --oc-bg:#eeede7;--oc-nav:#e6e5de;--oc-paper:#f8f7f2;--oc-surface:#efeee8;\n --oc-field:#efeee9;--oc-hover:#e2e3d9;--oc-rule:rgba(42,47,36,.14);\n --oc-text:#272923;--oc-soft:#41463c;--oc-muted:#646b60;\n --oc-accent:#687b5c;--oc-accent-ink:#fff;--oc-focus:#5a785e;\n --oc-shadow:0 6px 20px rgba(35,40,29,.055);\n color-scheme:light;\n}\nhtml[data-ramo-theme] body {background:var(--oc-bg)!important;color:var(--oc-text);}\n#ramo-stage-overlay-v180{font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;color:var(--oc-text);}\n/* Navigation: quiet selection rather than rows of little boxed cards. */\n#ramo-nav-shell-v190{font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;color:var(--oc-text)}\n#ramo-nav-shell-v190 .ramo-rail{background:var(--oc-nav);border-right:1px solid var(--oc-rule);gap:10px}\n#ramo-nav-shell-v190 .ramo-rail-btn{border:0!important;border-radius:9px;background:transparent!important;color:var(--oc-muted)!important;box-shadow:none!important;transition:background .12s,color .12s}\n#ramo-nav-shell-v190 .ramo-rail-btn:hover{background:var(--oc-hover)!important;color:var(--oc-text)!important}\n#ramo-nav-shell-v190 .ramo-rail-btn.active{background:var(--oc-surface)!important;color:var(--oc-accent)!important;box-shadow:inset 3px 0 var(--oc-accent)!important}\n#ramo-nav-shell-v190 .ramo-rail-spacer{border:0;height:6px}\n#ramo-nav-shell-v190 .ramo-rail-mic{border:0!important;border-radius:9px}\n#ramo-nav-shell-v190 .ramo-rail-mic.listening{background:var(--oc-surface)!important;box-shadow:0 0 0 2px var(--oc-focus)!important}\n#ramo-nav-shell-v190 .ramo-drawer{background:var(--oc-nav);border-right:1px solid var(--oc-rule);box-shadow:8px 0 20px rgba(0,0,0,.06);padding:18px 12px}\n#ramo-nav-shell-v190 .ramo-drawer-head{border-bottom:1px solid var(--oc-rule);margin-bottom:16px;padding:2px 6px 15px}\n#ramo-nav-shell-v190 .ramo-drawer-head b{font-size:18px;letter-spacing:-.35px;color:var(--oc-text);font-weight:680}\n#ramo-nav-shell-v190 .ramo-drawer-head span{display:none}\n#ramo-nav-shell-v190 .ramo-close{border:0;border-radius:8px;color:var(--oc-muted);background:transparent;font-size:22px}\n#ramo-nav-shell-v190 .ramo-close:hover{background:var(--oc-hover);color:var(--oc-text)}\n#ramo-nav-shell-v190 .ramo-assistant-btn,#ramo-nav-shell-v190 .ramo-drawer-btn,#ramo-nav-shell-v190 .ramo-theme-switch{background:transparent;border:0!important;color:var(--oc-soft);grid-template-columns:28px 1fr;min-height:42px;margin:2px 0;padding:8px 10px;border-radius:8px;box-shadow:none!important}\n#ramo-nav-shell-v190 .ramo-assistant-btn{margin-bottom:10px}\n#ramo-nav-shell-v190 .ramo-assistant-btn:hover,#ramo-nav-shell-v190 .ramo-drawer-btn:hover,#ramo-nav-shell-v190 .ramo-theme-switch:hover{background:var(--oc-hover)!important;color:var(--oc-text)}\n#ramo-nav-shell-v190 .ramo-assistant-btn.active,#ramo-nav-shell-v190 .ramo-drawer-btn.active{background:var(--oc-surface)!important;color:var(--oc-text)!important}\n#ramo-nav-shell-v190 .ramo-assistant-btn svg,#ramo-nav-shell-v190 .ramo-drawer-btn svg,#ramo-nav-shell-v190 .ramo-theme-switch svg{width:18px;height:18px;color:var(--oc-muted)!important}\n#ramo-nav-shell-v190 .ramo-drawer-btn b,#ramo-nav-shell-v190 .ramo-assistant-btn b,#ramo-nav-shell-v190 .ramo-theme-switch b{font-size:14px;font-weight:540;letter-spacing:0;color:inherit}\n#ramo-nav-shell-v190 .ramo-assistant-btn small,#ramo-nav-shell-v190 .ramo-drawer-btn small{display:none}\n#ramo-nav-shell-v190 .ramo-section-label,#ramo-nav-shell-v190 .ramo-drawer-context{display:none}\n#ramo-nav-shell-v190 .ramo-drawer-mic{background:transparent!important}\n#ramo-nav-shell-v190 .ramo-theme-switch{display:grid;width:100%;align-items:center;text-align:left;cursor:pointer;font:inherit}\n#ramo-nav-shell-v190 .ramo-theme-name{font-size:11px;font-weight:450;color:var(--oc-muted);margin-top:3px;display:block}\n#ramo-nav-shell-v190 .ramo-nav-separator{border-top:1px solid var(--oc-rule);margin:10px 4px 8px}\n/* Composer: ONE continuous input, quiet secondary microphone, meaningful send. */\n#ramo-composer-v180{border:1px solid var(--oc-rule)!important;background:var(--oc-paper)!important;box-shadow:var(--oc-shadow)!important;border-radius:13px!important;gap:7px!important}\n#ramo-command-input-v180{background:transparent!important;color:var(--oc-text)!important;border:0!important;box-shadow:none!important;font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif!important;font-size:15px!important;caret-color:var(--oc-focus)!important}\n#ramo-command-input-v180::placeholder{color:var(--oc-muted)!important;opacity:1}\n#ramo-command-input-v180:focus-visible{outline:0!important}\n#ramo-composer-v180:focus-within{border-color:var(--oc-focus)!important}\n#ramo-composer-mic,#ramo-composer-send{opacity:.95}\n#ramo-composer-mic svg,#ramo-composer-send svg{width:100%;height:100%;border-radius:8px}\n#ramo-composer-mic svg circle,#ramo-composer-mic svg rect,#ramo-composer-send svg rect{fill:transparent;stroke:none}\n#ramo-composer-mic svg path,#ramo-composer-mic svg g{stroke:var(--oc-muted)}\n#ramo-composer-send svg path{stroke:var(--oc-text)}\n#ramo-composer-send{background:var(--oc-surface)!important;border-radius:9px}\n#ramo-composer-send:hover{background:var(--oc-hover)!important}\n/* One content canvas: avoid outlines within outlines. */\n#ramo-workspace-pane-v180,#ramo-workspace-pane-v180.page-mode{border:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important}\n#ramo-workspace-pane-v180 .ramo-w-head,#ramo-workspace-pane-v180.page-mode .ramo-w-head{background:transparent!important;border:0!important;min-height:60px;padding:8px 12px 14px}\n#ramo-workspace-pane-v180 .ramo-w-kicker,#ramo-workspace-pane-v180 .ramo-w-model{display:none!important}\n#ramo-workspace-pane-v180 .ramo-w-subtitle{display:block!important;color:var(--oc-muted,#a0a8a5);font:400 12.5px/1.45 \"Segoe UI\",system-ui,sans-serif;max-width:560px}\n#ramo-workspace-pane-v180 .ramo-w-subtitle:empty{display:none!important}\n#ramo-workspace-pane-v180 .ramo-w-name,#ramo-workspace-pane-v180.page-mode .ramo-w-name{font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;font-weight:620;font-size:20px;letter-spacing:-.5px;color:var(--oc-text);margin-top:0}\n#ramo-workspace-pane-v180 .ramo-w-actions button{border:0!important;background:transparent!important;color:var(--oc-muted)!important;font-size:12px!important;padding:7px 10px!important}\n#ramo-workspace-pane-v180 .ramo-w-actions button:hover{background:var(--oc-hover)!important;color:var(--oc-text)!important}\n#ramo-workspace-pane-v180 .ramo-chat-scroll{padding:6px 18px 28px;scrollbar-color:var(--oc-rule) transparent}\n#ramo-workspace-pane-v180 .ramo-reading{font:400 15px/1.68 \"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;max-width:72ch;color:var(--oc-soft)}\n#ramo-workspace-pane-v180 .ramo-reading h1,#ramo-workspace-pane-v180 .ramo-reading h2,#ramo-workspace-pane-v180 .ramo-reading h3,#ramo-workspace-pane-v180 .ramo-reading h4{color:var(--oc-text);letter-spacing:-.02em}\n#ramo-workspace-pane-v180 .ramo-reading code{background:var(--oc-surface);color:var(--oc-text)}\n#ramo-workspace-pane-v180 .ramo-reading strong{color:var(--oc-text)}\n#ramo-workspace-pane-v180 .ramo-empty{padding-top:20px;color:var(--oc-muted);justify-content:center}\n#ramo-workspace-pane-v180 .ramo-empty b{color:var(--oc-text);font-size:18px;font-weight:570}\n#ramo-workspace-pane-v180 .ramo-empty span{font-size:14px;color:var(--oc-muted)}\n/* Pages embedded by the existing assistant backend: no functional changes. */\nhtml[data-ramo-theme] .tam-workspace{color:var(--oc-text);font:14px/1.5 \"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;background:var(--oc-bg)}\nhtml[data-ramo-theme] .tam-workspace .panel,html[data-ramo-theme] .tam-workspace[data-embedded=\"1\"] .panel{background:transparent;gap:14px;padding:12px 16px}\nhtml[data-ramo-theme] .tam-workspace h2,html[data-ramo-theme] .tam-workspace h3{color:var(--oc-text);letter-spacing:-.02em}\nhtml[data-ramo-theme] .tam-workspace .hub-kicker{display:none}\nhtml[data-ramo-theme] .tam-workspace button{background:var(--oc-surface);color:var(--oc-text);border:1px solid transparent;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:520}\nhtml[data-ramo-theme] .tam-workspace button:hover{background:var(--oc-hover)}\nhtml[data-ramo-theme] .tam-workspace button[aria-selected=\"true\"]{color:var(--oc-text);background:var(--oc-hover);border-bottom:2px solid var(--oc-accent);box-shadow:none}\nhtml[data-ramo-theme] .tam-workspace input:not([type=\"checkbox\"]):not([type=\"file\"]),html[data-ramo-theme] .tam-workspace select,html[data-ramo-theme] .tam-workspace textarea{background:var(--oc-paper);color:var(--oc-text);border:1px solid var(--oc-rule);border-radius:8px;font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;font-size:14px}\nhtml[data-ramo-theme] .tam-workspace textarea{font-family:ui-monospace,Consolas,monospace;line-height:1.6}\nhtml[data-ramo-theme] .tam-workspace input::placeholder,html[data-ramo-theme] .tam-workspace textarea::placeholder{color:var(--oc-muted)}\nhtml[data-ramo-theme] .tam-workspace :is(button,input,textarea,select):focus-visible{outline:2px solid var(--oc-focus);outline-offset:2px}\nhtml[data-ramo-theme] .tam-workspace .hint,html[data-ramo-theme] .tam-workspace .meta{color:var(--oc-muted);font-size:12.5px}\nhtml[data-ramo-theme] .tam-workspace .summary{color:var(--oc-soft);font-size:13px}\nhtml[data-ramo-theme] .tam-workspace .card,html[data-ramo-theme] .tam-workspace .section,html[data-ramo-theme] .tam-workspace .conversation{background:var(--oc-paper);border:0;border-radius:10px;padding:16px}\nhtml[data-ramo-theme] .tam-workspace .card h3,html[data-ramo-theme] .tam-workspace .section h3{color:var(--oc-text);font-size:16px}\nhtml[data-ramo-theme] .tam-workspace .badge{background:var(--oc-surface);border:0;color:var(--oc-muted);border-radius:5px}\nhtml[data-ramo-theme] .tam-workspace .stat{background:var(--oc-surface);border:0;border-radius:8px}\nhtml[data-ramo-theme] .tam-workspace .stat strong{color:var(--oc-text)}\nhtml[data-ramo-theme] .tam-workspace .role{color:var(--oc-muted)}\nhtml[data-ramo-theme] .tam-workspace .bubble.user{background:var(--oc-surface)}\nhtml[data-ramo-theme] .tam-workspace .bubble.assistant{background:var(--oc-paper)}\nhtml[data-ramo-theme] .tam-workspace .memory-shell{grid-template-columns:minmax(0,1fr) minmax(230px,290px);gap:16px}\nhtml[data-ramo-theme] .tam-workspace .memory-map{background:var(--oc-paper);border:0;border-radius:12px}\nhtml[data-ramo-theme] .tam-workspace .memory-inspector{background:var(--oc-paper);border:0;border-radius:12px;color:var(--oc-soft)}\nhtml[data-ramo-theme] .tam-workspace .memory-inspector-title{color:var(--oc-text)}\nhtml[data-ramo-theme] .tam-workspace .memory-node{color:var(--oc-text)}\nhtml[data-ramo-theme] .tam-workspace .memory-empty{color:var(--oc-muted)}\nhtml[data-ramo-theme] .tam-workspace .research-source{background:var(--oc-paper);border:0;border-bottom:1px solid var(--oc-rule);border-radius:7px;color:var(--oc-text)}\nhtml[data-ramo-theme] .tam-workspace .research-snippet{color:var(--oc-muted)}\nhtml[data-ramo-theme] .tam-workspace .list{gap:8px}\nhtml[data-ramo-theme] .tam-workspace .items{gap:5px}\nhtml[data-ramo-theme] .tam-workspace .items button{text-align:left}\nhtml[data-ramo-theme] .tam-workspace .split{grid-template-columns:minmax(155px,235px) minmax(0,1fr);gap:18px}\nhtml[data-ramo-theme] .tam-workspace .notice{color:var(--oc-accent)}\nhtml[data-ramo-theme] .tam-workspace a{color:var(--oc-accent)}\n@media(max-width:780px){html[data-ramo-theme] .tam-workspace .memory-shell{grid-template-columns:1fr;overflow:auto;height:auto;max-height:100%}html[data-ramo-theme] .tam-workspace .memory-map{min-height:230px}html[data-ramo-theme] .tam-workspace .split{grid-template-columns:1fr}}\n@media(prefers-reduced-motion:reduce){#ramo-window-art-v210 img{animation-duration:.001s!important}#ramo-nav-shell-v190 *{transition:none!important}}\n";
const OC_V26_CSS="/* Ramo 2.6 \u2014 vivid identity / quiet working surfaces */\nhtml[data-ramo-theme=\"graphite\"]{--oc-bg:#202322;--oc-nav:#272b29;--oc-paper:#272b2a;--oc-surface:#303633;--oc-field:#333835;--oc-hover:#3a413d;--oc-rule:rgba(228,237,229,.105);--oc-text:#f4f3ee;--oc-soft:#dcdfd8;--oc-muted:#a4aca4;--oc-accent:#c9d2c3;--oc-accent-ink:#202522;--oc-focus:#c7d8c3;color-scheme:dark}\nhtml[data-ramo-theme=\"paper\"]{--oc-bg:#f4f3ed;--oc-nav:#ecebe4;--oc-paper:#fffefa;--oc-surface:#e9ece6;--oc-field:#efeee9;--oc-hover:#dfe5de;--oc-rule:rgba(42,54,46,.14);--oc-text:#252b27;--oc-soft:#454d46;--oc-muted:#69756c;--oc-accent:#476452;--oc-accent-ink:#fff;--oc-focus:#456e50;color-scheme:light}\n#ramo-stage-overlay-v180{font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif}\n/* Navigation and menu are parts of one system, not two separate apps. */\n#ramo-nav-shell-v190 .ramo-rail{gap:8px;background:var(--oc-nav)}\n#ramo-nav-shell-v190 .ramo-rail-btn{border-radius:10px;color:var(--oc-muted)!important}\n#ramo-nav-shell-v190 .ramo-rail-btn.active{color:var(--oc-text)!important;box-shadow:inset 2px 0 var(--oc-text)!important}\n#ramo-nav-shell-v190 .ramo-assistant-btn,#ramo-nav-shell-v190 .ramo-drawer-btn{min-height:43px;margin:2px 0;border-radius:9px}\n#ramo-nav-shell-v190 .ramo-drawer{box-shadow:8px 0 16px rgba(0,0,0,.045)}\n#ramo-nav-shell-v190 .ramo-drawer-head{border-bottom:0;padding-bottom:7px;margin-bottom:12px}\n#ramo-nav-shell-v190 .ramo-assistant-btn{margin-bottom:6px}\n#ramo-nav-shell-v190 .ramo-assistant-btn svg,#ramo-nav-shell-v190 .ramo-drawer-btn svg{width:19px;height:19px}\n#ramo-nav-shell-v190 .ramo-nav-separator{margin:14px 7px 9px}\n#ramo-nav-shell-v190 .ramo-theme-switch{margin-top:6px}\n#ramo-nav-shell-v190 .ramo-theme-switch svg{width:18px;height:18px}\n#ramo-nav-shell-v190 .ramo-rail-btn[data-page=\"system\"]{margin-top:auto}\n#ramo-nav-shell-v190 .ramo-rail-btn[data-page=\"system\"]+ .ramo-rail-btn{margin-top:0}\n#ramo-composer-v180{border-radius:15px!important;box-shadow:none!important;padding-left:10px!important;padding-right:8px!important}\n#ramo-composer-v180 #ramo-composer-send{background:var(--oc-surface)!important;border:0!important}\n#ramo-composer-v180 #ramo-composer-send:hover{background:var(--oc-hover)!important}\n#ramo-workspace-pane-v180 .ramo-w-head{min-height:56px!important;padding-left:8px!important;padding-top:4px!important}\n#ramo-workspace-pane-v180 .ramo-w-name{font-size:18px!important;font-weight:620!important;letter-spacing:-.4px}\n#ramo-workspace-pane-v180 .ramo-w-copy{color:var(--oc-muted)!important}\n#ramo-workspace-pane-v180 .ramo-chat-scroll{padding:7px 14px 32px!important}\n#ramo-workspace-pane-v180 .ramo-reading{font-size:15px!important;line-height:1.7!important}\n#ramo-workspace-pane-v180 .ramo-empty{padding-top:8px!important}\n#ramo-workspace-pane-v180 .ramo-empty b{font-size:16px!important;font-weight:580!important}\n#ramo-core-layer{position:absolute;pointer-events:none;z-index:1;overflow:visible;contain:layout style}\n#ramo-core-layer .oc-core-svg{width:100%;height:100%;display:block;overflow:visible;touch-action:none;user-select:none;pointer-events:auto}\n#ramo-core-layer .oc-core-caption{position:absolute;top:-12px;left:0;width:100%;text-align:center;font:600 11px/1.2 \"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;letter-spacing:.045em;color:var(--oc-soft);pointer-events:none}\n#ramo-core-layer .oc-core-note{position:absolute;top:calc(100% + 4px);left:-14%;width:128%;text-align:center;font:500 12px/1.3 \"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif;color:var(--oc-muted);letter-spacing:.01em;white-space:nowrap;pointer-events:none}\n#ramo-core-layer .oc-core-caption::before{content:\"\";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--core-primary);margin-right:7px;vertical-align:2px}\n/* Aster presence artwork, extracted without the standalone demo page or controls. */\n#ramo-core-layer .floor-track{fill:none;stroke:#567d9a;stroke-width:1.25;stroke-opacity:.21}\n#ramo-core-layer .primary-track{fill:none;stroke:#81afc8;stroke-width:1;stroke-opacity:.14}\n#ramo-core-layer .secondary-track{fill:none;stroke:#7497b0;stroke-width:1;stroke-opacity:.19}\n#ramo-core-layer .outer-piece{cursor:grab}\n#ramo-core-layer .oc-core-svg.dragging .outer-piece{cursor:grabbing}\n#ramo-core-layer .segment-bloom{stroke:var(--model);stroke-opacity:.23;stroke-width:22;stroke-linecap:round;filter:url(#ocAsterBloom)}\n#ramo-core-layer .segment-face{stroke:var(--model);stroke-opacity:.92;stroke-width:13;stroke-linecap:round;fill:none}\n#ramo-core-layer .segment-spec{stroke:#f3ffff;stroke-opacity:.58;stroke-width:2.15;stroke-linecap:round;fill:none}\n#ramo-core-layer .inner-face{fill:none;stroke:var(--model);stroke-width:5;stroke-linecap:round}\n#ramo-core-layer .inner-bloom{fill:none;stroke:var(--model);stroke-opacity:.22;stroke-width:11;stroke-linecap:round;filter:url(#ocAsterBloom)}\n#ramo-core-layer .outer-aura{stroke:var(--model);fill:none;stroke-width:1.5;stroke-opacity:.13}\n#ramo-core-layer .core-halo{fill:url(#ocAsterHaloFade)}\n#ramo-core-layer .core-body{fill:#4f6d84;stroke:#e9f7ff;stroke-opacity:.24;stroke-width:1.25}\n#ramo-core-layer .core-innerglow{fill:var(--aura1);fill-opacity:.10}\n#ramo-core-layer .core-center{fill:#f5fbff}\n#ramo-core-layer .wave-ripple{fill:none;stroke:var(--aura1);stroke-opacity:0;stroke-width:1.5}\n#ramo-core-layer .segment-face,#ramo-core-layer .inner-face,#ramo-core-layer .core-halo,#ramo-core-layer .core-innerglow{transition:stroke .45s ease,fill .45s ease,opacity .35s ease}\n@media(prefers-reduced-motion:reduce){#ramo-core-layer .oc-core-svg{animation:none!important}}\n#ramo-nav-shell-v190 .ramo-mini-core{color:var(--core-primary,#88ed61)!important}\n#ramo-nav-shell-v190 .ramo-mini-core .oc-mini-ring{transform-origin:12px 12px;animation:oc-mini-turn var(--mini-dur,65s) linear infinite}\n#ramo-nav-shell-v190 [data-page=\"home\"].active .ramo-mini-core{filter:drop-shadow(0 0 4px color-mix(in srgb,var(--core-primary) 30%,transparent))}\n@keyframes oc-mini-turn{to{transform:rotate(360deg)}}\n@media(prefers-reduced-motion:reduce){#ramo-nav-shell-v190 .oc-mini-ring{animation:none!important}}\n";
const OC_V27_CSS="";
const PAGE_META={
 home:{kicker:'ASSISTANT',title:'Conversation',subtitle:'Your current conversation and responses.'},
 research:{kicker:'PAGE',title:'Research',subtitle:'Saved research, evidence, and source-backed findings.'},
 memory:{kicker:'PAGE',title:'Memory',subtitle:'Saved personal context, observations, and recall.'},
 files:{kicker:'PAGE',title:'Files',subtitle:'Local text files and document workspace.'},
 archive:{kicker:'PAGE',title:'Archive',subtitle:'Previous conversations and saved exchanges.'},
 system:{kicker:'PAGE',title:'System',subtitle:'Assistant runtime, local models, and diagnostics.'}
};
const MIC_OFF='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.8 11.2v1.3a6.2 6.2 0 0 0 12.4 0v-1.3M12 18.7v2.5M8.5 21.2h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const MIC_ON='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.8 11.2v1.3a6.2 6.2 0 0 0 12.4 0v-1.3M12 18.7v2.5M8.5 21.2h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const SEND_SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect x="1" y="1" width="34" height="34" rx="10" fill="#0a2430" stroke="#4b8299"/><path d="M11.5 11.5l14 6.5-14 6.5 3.5-6.5z" fill="none" stroke="#d2f3ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CORE_ART={"Core Outer Ring":{"Outer Ring":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"48\" stroke=\"#3f4c43\" stroke-width=\"1.2\"/>\n <circle cx=\"52\" cy=\"52\" r=\"44\" stroke=\"#9cbaa6\" stroke-width=\"1.4\" stroke-dasharray=\"28 7 12 7\"/>\n <g stroke=\"#9cbaa6\" stroke-width=\"1.15\" opacity=\".9\">\n  <path d=\"M52 1v7M52 96v7M1 52h7M96 52h7\"/>\n  <path d=\"M16 16l5 5M83 83l5 5M88 16l-5 5M21 83l-5 5\"/>\n </g>\n</g></svg>","FAST":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"5\" y1=\"8\" x2=\"99\" y2=\"96\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#92bc8f\"/><stop offset=\".52\" stop-color=\"#d5be7d\"/><stop offset=\"1\" stop-color=\"#92bc8f\"/>\n </linearGradient>\n <linearGradient id=\"g2\" x1=\"96\" y1=\"8\" x2=\"8\" y2=\"96\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#d5be7d\"/><stop offset=\".5\" stop-color=\"#92bc8f\"/><stop offset=\"1\" stop-color=\"#92bc8f\"/>\n </linearGradient>\n</defs>\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"48\" stroke=\"#292d29\" stroke-width=\"1.2\"/>\n <circle cx=\"52\" cy=\"52\" r=\"44\" stroke=\"url(#g)\" stroke-width=\"1.65\" stroke-dasharray=\"28 7 12 7\"/>\n <g stroke=\"url(#g2)\" stroke-width=\"1.2\" opacity=\".95\">\n  <path d=\"M52 1v7M52 96v7M1 52h7M96 52h7\"/>\n  <path d=\"M16 16l5 5M83 83l5 5M88 16l-5 5M21 83l-5 5\"/>\n </g>\n</g></svg>","DEEP":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"5\" y1=\"8\" x2=\"99\" y2=\"96\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#9cbaa6\"/><stop offset=\".52\" stop-color=\"#a096b2\"/><stop offset=\"1\" stop-color=\"#9cbaa6\"/>\n </linearGradient>\n <linearGradient id=\"g2\" x1=\"96\" y1=\"8\" x2=\"8\" y2=\"96\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#a096b2\"/><stop offset=\".5\" stop-color=\"#9cbaa6\"/><stop offset=\"1\" stop-color=\"#9cbaa6\"/>\n </linearGradient>\n</defs>\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"48\" stroke=\"#3d4a41\" stroke-width=\"1.2\"/>\n <circle cx=\"52\" cy=\"52\" r=\"44\" stroke=\"url(#g)\" stroke-width=\"1.65\" stroke-dasharray=\"28 7 12 7\"/>\n <g stroke=\"url(#g2)\" stroke-width=\"1.2\" opacity=\".95\">\n  <path d=\"M52 1v7M52 96v7M1 52h7M96 52h7\"/>\n  <path d=\"M16 16l5 5M83 83l5 5M88 16l-5 5M21 83l-5 5\"/>\n </g>\n</g></svg>","ERROR":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"5\" y1=\"8\" x2=\"99\" y2=\"96\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#be816e\"/><stop offset=\".52\" stop-color=\"#be816e\"/><stop offset=\"1\" stop-color=\"#be816e\"/>\n </linearGradient>\n <linearGradient id=\"g2\" x1=\"96\" y1=\"8\" x2=\"8\" y2=\"96\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#be816e\"/><stop offset=\".5\" stop-color=\"#be816e\"/><stop offset=\"1\" stop-color=\"#be816e\"/>\n </linearGradient>\n</defs>\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"48\" stroke=\"#3d4a41\" stroke-width=\"1.2\"/>\n <circle cx=\"52\" cy=\"52\" r=\"44\" stroke=\"url(#g)\" stroke-width=\"1.65\" stroke-dasharray=\"28 7 12 7\"/>\n <g stroke=\"url(#g2)\" stroke-width=\"1.2\" opacity=\".95\">\n  <path d=\"M52 1v7M52 96v7M1 52h7M96 52h7\"/>\n  <path d=\"M16 16l5 5M83 83l5 5M88 16l-5 5M21 83l-5 5\"/>\n </g>\n</g></svg>"},"Core Inner Ring":{"Inner Ring":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"36\" stroke=\"#87a18f\" stroke-width=\"1.2\" stroke-dasharray=\"5 6\"/>\n <circle cx=\"52\" cy=\"52\" r=\"29\" stroke=\"#3d4a41\" stroke-width=\"1\"/>\n <path d=\"M30 24a38 38 0 0 1 44 0M80 75a38 38 0 0 1-56 0\" stroke=\"#9cbaa6\" stroke-width=\"1.5\"/>\n</g></svg>","FAST":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"18\" y1=\"16\" x2=\"88\" y2=\"90\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#92bc8f\"/><stop offset=\".5\" stop-color=\"#d5be7d\"/><stop offset=\"1\" stop-color=\"#92bc8f\"/>\n </linearGradient>\n</defs>\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"36\" stroke=\"#3e4b42\" stroke-width=\"1.2\" stroke-dasharray=\"5 6\"/>\n <circle cx=\"52\" cy=\"52\" r=\"29\" stroke=\"#292d29\" stroke-width=\"1\"/>\n <path d=\"M30 24a38 38 0 0 1 44 0M80 75a38 38 0 0 1-56 0\" stroke=\"url(#g)\" stroke-width=\"1.75\"/>\n</g></svg>","DEEP":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"18\" y1=\"16\" x2=\"88\" y2=\"90\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#9cbaa6\"/><stop offset=\".5\" stop-color=\"#a096b2\"/><stop offset=\"1\" stop-color=\"#9cbaa6\"/>\n </linearGradient>\n</defs>\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"36\" stroke=\"#86a08f\" stroke-width=\"1.2\" stroke-dasharray=\"5 6\"/>\n <circle cx=\"52\" cy=\"52\" r=\"29\" stroke=\"#3c4941\" stroke-width=\"1\"/>\n <path d=\"M30 24a38 38 0 0 1 44 0M80 75a38 38 0 0 1-56 0\" stroke=\"url(#g)\" stroke-width=\"1.75\"/>\n</g></svg>","ERROR":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"18\" y1=\"16\" x2=\"88\" y2=\"90\" gradientUnits=\"userSpaceOnUse\">\n  <stop offset=\"0\" stop-color=\"#be816e\"/><stop offset=\".5\" stop-color=\"#be816e\"/><stop offset=\"1\" stop-color=\"#be816e\"/>\n </linearGradient>\n</defs>\n<g fill=\"none\" stroke-linecap=\"round\">\n <circle cx=\"52\" cy=\"52\" r=\"36\" stroke=\"#404e44\" stroke-width=\"1.2\" stroke-dasharray=\"5 6\"/>\n <circle cx=\"52\" cy=\"52\" r=\"29\" stroke=\"#292d29\" stroke-width=\"1\"/>\n <path d=\"M30 24a38 38 0 0 1 44 0M80 75a38 38 0 0 1-56 0\" stroke=\"url(#g)\" stroke-width=\"1.75\"/>\n</g></svg>"},"Core Pulse":{"Pulse":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n <circle cx=\"52\" cy=\"52\" r=\"20\" fill=\"#282b28\" stroke=\"#3f4c43\" stroke-width=\"1.3\"/>\n <circle cx=\"52\" cy=\"52\" r=\"12\" fill=\"#292d29\" stroke=\"#9cbaa6\" stroke-width=\"1.2\"/>\n <circle cx=\"52\" cy=\"52\" r=\"5\" fill=\"#9cbaa6\"/>\n</svg>","FAST":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"34\" y1=\"30\" x2=\"75\" y2=\"77\" gradientUnits=\"userSpaceOnUse\">\n   <stop offset=\"0\" stop-color=\"#92bc8f\"/><stop offset=\"1\" stop-color=\"#d5be7d\"/>\n </linearGradient>\n <radialGradient id=\"core\" cx=\"42%\" cy=\"38%\" r=\"68%\">\n   <stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".38\" stop-color=\"#d5be7d\"/><stop offset=\"1\" stop-color=\"#92bc8f\"/>\n </radialGradient>\n</defs>\n <circle cx=\"52\" cy=\"52\" r=\"20\" fill=\"#272b27\" stroke=\"#292d29\" stroke-width=\"1.3\"/>\n <circle cx=\"52\" cy=\"52\" r=\"12\" fill=\"#292d29\" stroke=\"url(#g)\" stroke-width=\"1.45\"/>\n <circle cx=\"52\" cy=\"52\" r=\"5.2\" fill=\"url(#core)\"/>\n</svg>","DEEP":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"34\" y1=\"30\" x2=\"75\" y2=\"77\" gradientUnits=\"userSpaceOnUse\">\n   <stop offset=\"0\" stop-color=\"#9cbaa6\"/><stop offset=\"1\" stop-color=\"#a096b2\"/>\n </linearGradient>\n <radialGradient id=\"core\" cx=\"42%\" cy=\"38%\" r=\"68%\">\n   <stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".38\" stop-color=\"#a096b2\"/><stop offset=\"1\" stop-color=\"#9cbaa6\"/>\n </radialGradient>\n</defs>\n <circle cx=\"52\" cy=\"52\" r=\"20\" fill=\"#282c28\" stroke=\"#3f4c43\" stroke-width=\"1.3\"/>\n <circle cx=\"52\" cy=\"52\" r=\"12\" fill=\"#3c4940\" stroke=\"url(#g)\" stroke-width=\"1.45\"/>\n <circle cx=\"52\" cy=\"52\" r=\"5.2\" fill=\"url(#core)\"/>\n</svg>","ERROR":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"104\" height=\"104\" viewBox=\"0 0 104 104\">\n<defs>\n <linearGradient id=\"g\" x1=\"34\" y1=\"30\" x2=\"75\" y2=\"77\" gradientUnits=\"userSpaceOnUse\">\n   <stop offset=\"0\" stop-color=\"#be816e\"/><stop offset=\"1\" stop-color=\"#be816e\"/>\n </linearGradient>\n <radialGradient id=\"core\" cx=\"42%\" cy=\"38%\" r=\"68%\">\n   <stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".38\" stop-color=\"#be816e\"/><stop offset=\"1\" stop-color=\"#be816e\"/>\n </radialGradient>\n</defs>\n <circle cx=\"52\" cy=\"52\" r=\"20\" fill=\"#282b28\" stroke=\"#3f4d43\" stroke-width=\"1.3\"/>\n <circle cx=\"52\" cy=\"52\" r=\"12\" fill=\"#292d29\" stroke=\"url(#g)\" stroke-width=\"1.45\"/>\n <circle cx=\"52\" cy=\"52\" r=\"5.2\" fill=\"url(#core)\"/>\n</svg>"},"Core Activity":{"READY":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#9cbaa6\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#9cbaa6\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">READY</text>\n    </svg>","THINKING":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#9cbaa6\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#9cbaa6\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">THINKING</text>\n    </svg>","RECALLING MEMORY":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#9cbaa6\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#9cbaa6\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">RECALLING MEMORY</text>\n    </svg>","SEARCHING WEB":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#9cbaa6\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#9cbaa6\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">SEARCHING WEB</text>\n    </svg>","SEARCHING SCIENCE":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#9cbaa6\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#9cbaa6\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">SEARCHING SCIENCE</text>\n    </svg>","DEEP RESEARCH":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#9cbaa6\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#9cbaa6\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">DEEP RESEARCH</text>\n    </svg>","GENERATING RESPONSE":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#e6f8ff\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#e6f8ff\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">GENERATING RESPONSE</text>\n    </svg>","SPEAKING":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#ffffff\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#ffffff\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">SPEAKING</text>\n    </svg>","ERROR":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"190\" height=\"24\" viewBox=\"0 0 190 24\">\n      <line x1=\"1\" y1=\"12\" x2=\"33\" y2=\"12\" stroke=\"#3f4c43\" stroke-width=\"1\"/>\n      <circle cx=\"39\" cy=\"12\" r=\"3.5\" fill=\"#be816e\"/>\n      <text x=\"49\" y=\"15.2\" fill=\"#be816e\" font-family=\"Arial,Helvetica,sans-serif\" font-size=\"9\" font-weight=\"700\" letter-spacing=\"1.2\">ERROR</text>\n    </svg>"}};
const OC_V281_CSS="/* 2.8.12 neutral Graphite background; color belongs to the core, not the canvas. */\nhtml[data-ramo-theme=\"graphite\"]{--oc-bg:#1f2123;--oc-nav:#242628;--oc-paper:#282b2d;--oc-surface:#303437;--oc-field:#313538;--oc-hover:#393e41;--oc-rule:rgba(236,241,244,.105);--oc-text:#f0f2f3;--oc-soft:#d1d7d9;--oc-muted:#9ca6ac;--oc-accent:#aebcba;--oc-focus:#9bbdb9;--oc-accent-ink:#1f2123}\n#ramo-composer-v180 #ramo-composer-mic{color:var(--oc-muted)!important;background:transparent!important;opacity:1;display:grid!important;place-items:center!important}\n#ramo-composer-v180 #ramo-composer-mic:hover{color:var(--oc-text)!important}\n#ramo-composer-v180 #ramo-composer-mic svg{width:25px!important;height:25px!important;overflow:visible}\n#ramo-composer-v180 #ramo-composer-mic svg rect{fill:none!important;stroke:currentColor!important}\n#ramo-composer-v180 #ramo-composer-mic svg path{stroke:currentColor!important}\n#ramo-nav-shell-v190 .ramo-rail-btn[data-page=\"system\"]{margin-top:0}\n#ramo-nav-shell-v190 .ramo-rail-btn[data-page=\"computer\"]{margin-top:0}\n#ramo-nav-shell-v190 .ramo-rail-btn[data-page=\"computer\"].active,#ramo-nav-shell-v190 .ramo-rail-btn[data-page=\"models\"].active{background:var(--oc-surface)!important;color:var(--oc-text)!important}\n";
const OC_V215_CSS='\n/* 2.8.15 Unified chat: same Graphite tokens for header, menus, conversation and composer. */\nhtml[data-ramo-theme="graphite"]{--oc-bg:#1f2123;--oc-nav:#242628;--oc-paper:#282b2d;--oc-surface:#303437;--oc-field:#313538;--oc-hover:#393e41;--oc-rule:#393e41;--oc-text:#eef0ef;--oc-soft:#d1d6d3;--oc-muted:#a0a8a5;--oc-accent:#a0c4b0;--oc-focus:#a3c8b7}\n#ramo-workspace-pane-v180:not(.page-mode){border:0!important;background:transparent!important;box-shadow:none!important;border-radius:0!important}\n#ramo-workspace-pane-v180 .ramo-w-head{display:flex!important;flex:none!important;align-items:center!important;gap:12px!important;justify-content:flex-start!important;padding:0 8px 13px!important;border:0!important;background:transparent!important;min-height:44px!important}\n#ramo-workspace-pane-v180 .ramo-w-title{display:flex!important;align-items:center!important;gap:14px!important;min-width:0!important;max-width:100%!important;flex:0 1 auto!important}\n#ramo-workspace-pane-v180 .ramo-w-name{color:var(--oc-text)!important;font:600 19px/1.3 "Segoe UI",system-ui,sans-serif!important;min-width:0!important;max-width:300px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}\n#ramo-workspace-pane-v180 .ramo-w-kicker,#ramo-workspace-pane-v180 .ramo-w-actions{display:none!important}\n#ramo-workspace-pane-v180 .oc-header-model{display:inline-flex!important;gap:0!important;align-items:center!important;flex:none!important;min-width:0!important}\n#ramo-workspace-pane-v180 .oc-header-model[hidden]{display:none!important}\n#ramo-workspace-pane-v180 .oc-header-model .oc-model-label{display:none!important}\n#ramo-workspace-pane-v180 .oc-chat-model{appearance:auto!important;min-width:98px!important;max-width:162px!important;width:auto!important;height:32px!important;padding:4px 9px!important;border-radius:9px!important;color:var(--oc-text)!important;background:var(--oc-surface)!important;border:1px solid var(--oc-rule)!important;font:550 12px "Segoe UI",system-ui,sans-serif!important;cursor:pointer!important}\n#ramo-workspace-pane-v180 .ramo-w-content{min-height:0!important;flex:1!important}\n#ramo-workspace-pane-v180 .ramo-chat-scroll{border:0!important;background:transparent!important;padding:12px 8px 24px!important}\n#ramo-workspace-pane-v180 .ramo-reading{font:14px/1.65 "Segoe UI",system-ui,sans-serif!important;color:var(--oc-soft)!important}\n#ramo-workspace-pane-v180 .ramo-empty{color:var(--oc-muted)!important;padding-top:14px!important}\n#ramo-workspace-pane-v180 .ramo-empty b{color:var(--oc-text)!important}\n#ramo-workspace-pane-v180 .ramo-w-chat{border:0!important;border-radius:9px!important;box-shadow:none!important}\n#ramo-workspace-pane-v180 .ramo-w-chat.user{background:var(--oc-paper)!important;color:var(--oc-text)!important}\n#ramo-workspace-pane-v180 .ramo-w-chat.assistant{background:transparent!important;color:var(--oc-soft)!important}\n#ramo-workspace-pane-v180 .oc-message-actions{display:flex;align-items:center;justify-content:flex-start;margin-top:4px}\n#ramo-workspace-pane-v180 .oc-message-copy{border:0;background:transparent;color:var(--oc-muted);font:500 11px "Segoe UI",system-ui,sans-serif;padding:4px 8px;border-radius:6px;cursor:pointer}\n#ramo-workspace-pane-v180 .oc-message-copy:hover{background:var(--oc-hover);color:var(--oc-text)}\n#ramo-workspace-pane-v180 .oc-inline-link{color:var(--oc-accent)!important}\n#ramo-composer-v180{color:var(--oc-text)!important;border-color:var(--oc-rule)!important;background:var(--oc-paper)!important}\n#ramo-composer-v180 #ramo-composer-mic,#ramo-composer-v180 #ramo-composer-send{color:var(--oc-soft)!important}\n#ramo-composer-v180 #ramo-composer-mic:hover,#ramo-composer-v180 #ramo-composer-send:hover{background:var(--oc-hover)!important;color:var(--oc-text)!important}\n#ramo-composer-v180 .oc-thinking-quick{flex:none;padding:8px 10px;white-space:nowrap;border:1px solid transparent;border-radius:9px;cursor:pointer;font:600 12px "Segoe UI",system-ui,sans-serif;color:var(--oc-muted);background:transparent}\n#ramo-composer-v180 .oc-thinking-quick:hover{background:var(--oc-hover);color:var(--oc-text)}\n#ramo-composer-v180 .oc-thinking-quick[aria-pressed="true"]{color:var(--oc-text);border-color:rgba(160,196,176,.40);background:rgba(160,196,176,.15)}\n#ramo-composer-v180 .oc-more-quick{flex:none;height:33px;min-width:33px;border:0;border-radius:9px;color:var(--oc-soft);background:transparent;cursor:pointer;font:700 23px/1 "Segoe UI",system-ui,sans-serif}\n#ramo-composer-v180 .oc-more-quick:hover,#ramo-composer-v180 .oc-more-quick[aria-expanded="true"]{background:var(--oc-hover)}\n#ramo-composer-v180 .oc-session-menu,#ramo-composer-v180 .oc-voice-panel{position:absolute!important;bottom:calc(100% + 10px)!important;top:auto!important;right:0!important;left:auto!important;width:min(335px,calc(100vw - 80px))!important;display:flex!important;flex-direction:column!important;gap:13px!important;background:var(--oc-paper)!important;border:1px solid var(--oc-rule)!important;color:var(--oc-text)!important;border-radius:13px!important;box-shadow:0 16px 40px rgba(0,0,0,.38)!important;padding:16px!important;max-height:min(500px,68vh)!important;overflow:auto!important;z-index:2147483500!important}\n#ramo-composer-v180 .oc-session-title{font:650 15px "Segoe UI",system-ui,sans-serif}\n#ramo-composer-v180 .oc-session-field{display:flex;flex-direction:column;gap:7px;font:550 12px "Segoe UI",system-ui,sans-serif;color:var(--oc-soft)}\n#ramo-composer-v180 .oc-session-field select{padding:9px;border:1px solid var(--oc-rule);border-radius:8px;background:var(--oc-surface);color:var(--oc-text)}\n#ramo-composer-v180 .oc-voice-settings{background:var(--oc-surface);color:var(--oc-text);border:1px solid var(--oc-rule);border-radius:9px;padding:10px;text-align:left;cursor:pointer}\n#ramo-composer-v180 .oc-session-help{font:12px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted)}\n#ramo-composer-v180 .oc-quick-status{position:absolute;left:10px;bottom:calc(100% + 9px);background:var(--oc-paper);color:var(--oc-soft);border:1px solid var(--oc-rule);border-radius:8px;padding:8px 12px;font:12px "Segoe UI",system-ui,sans-serif}\n#ramo-composer-v180 .oc-quick-status[hidden]{display:none!important}\n#ramo-nav-shell-v190 .ramo-drawer,#ramo-nav-shell-v190 .ramo-rail{background:var(--oc-nav)!important;border-color:var(--oc-rule)!important}\n#ramo-nav-shell-v190 .ramo-rail-btn.active{color:var(--oc-accent)!important;box-shadow:inset 3px 0 var(--oc-accent)!important}\n@media(max-width:1150px){#ramo-workspace-pane-v180 .ramo-w-name{max-width:190px!important}}\n@media(max-width:620px){#ramo-workspace-pane-v180 .ramo-w-head{padding:0 4px 7px!important;min-height:38px!important}#ramo-workspace-pane-v180 .ramo-w-name{font-size:15px!important;max-width:120px!important}#ramo-workspace-pane-v180 .oc-chat-model{min-width:82px!important;max-width:110px!important;font-size:11px!important}#ramo-composer-v180{gap:2px!important;padding:5px!important}#ramo-composer-v180 .oc-thinking-quick{padding:6px 3px;font-size:10px}#ramo-composer-v180 .oc-more-quick{min-width:25px;font-size:19px}#ramo-composer-v180 #ramo-composer-mic,#ramo-composer-v180 #ramo-composer-send{min-width:29px!important;width:29px!important}#ramo-composer-v180 #ramo-command-input-v180{padding:0 3px!important}}\n';
const OC_V215_VOICE_CSS='\n#ramo-composer-v180 .oc-voice-panel{font:12px/1.5 "Segoe UI",system-ui,sans-serif!important}\n#ramo-composer-v180 .oc-voice-panel p,#ramo-composer-v180 .oc-voice-panel .oc-voice-path{color:var(--oc-muted)!important;margin:0}\n#ramo-composer-v180 .oc-voice-panel label{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--oc-soft)}\n#ramo-composer-v180 .oc-voice-panel select{background:var(--oc-surface);border:1px solid var(--oc-rule);border-radius:8px;padding:7px;color:var(--oc-text)}\n#ramo-composer-v180 .oc-voice-panel button{background:var(--oc-surface);border:1px solid var(--oc-rule);border-radius:8px;padding:9px 12px;color:var(--oc-text);cursor:pointer}\n#ramo-composer-v180 .oc-voice-panel button:hover{background:var(--oc-hover)}\n#ramo-composer-v180 .oc-voice-panel .oc-voice-row{display:flex;flex-wrap:wrap;gap:8px}\n#ramo-composer-v180 .oc-voice-panel .oc-voice-message{color:var(--oc-soft)!important}\n';
const OC_V214_CSS="/* 2.8.14: unified Graphite for all first-party dialogs and navigation. */\n#ramo-workspace-pane-v180 .ramo-w-title{flex:1 1 180px;min-width:135px}\n#ramo-workspace-pane-v180 .ramo-w-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:calc(100% - 4px)}\n#ramo-workspace-pane-v180 .ramo-w-head{gap:12px!important;flex-wrap:wrap}\n#ramo-workspace-pane-v180 .ramo-w-actions{max-width:100%;flex:0 1 auto}\n\nhtml[data-ramo-theme=\"graphite\"]{--oc-bg:#1f2123;--oc-nav:#242628;--oc-paper:#282b2d;--oc-surface:#303437;--oc-field:#313538;--oc-hover:#393e41;--oc-rule:#393e41;--oc-text:#eef0ef;--oc-soft:#d1d6d3;--oc-muted:#a0a8a5;--oc-accent:#a0c4b0;--oc-focus:#a3c8b7}\n#ramo-workspace-pane-v180 .oc-voice-panel,\n#ramo-workspace-pane-v180 .oc-chat-menu{\n background:var(--oc-paper)!important;color:var(--oc-text)!important;border:1px solid var(--oc-rule)!important;border-radius:12px!important;box-shadow:0 14px 36px rgba(0,0,0,.40)!important;font-family:\"Segoe UI Variable\",\"Segoe UI\",system-ui,sans-serif!important}\n#ramo-workspace-pane-v180 .oc-voice-panel p,#ramo-workspace-pane-v180 .oc-voice-panel .oc-voice-path{color:var(--oc-muted)!important}\n#ramo-workspace-pane-v180 .oc-voice-panel select,\n#ramo-workspace-pane-v180 .oc-model-picker select{\n color:var(--oc-text)!important;background:var(--oc-surface)!important;border:1px solid var(--oc-rule)!important;border-radius:8px!important}\n#ramo-workspace-pane-v180 .oc-voice-panel label,#ramo-workspace-pane-v180 .oc-model-picker{color:var(--oc-soft)!important}\n#ramo-workspace-pane-v180 .oc-voice-row button,\n#ramo-workspace-pane-v180 .oc-chat-option button{color:var(--oc-text)!important;background:var(--oc-surface)!important;border:1px solid var(--oc-rule)!important;border-radius:8px!important}\n#ramo-workspace-pane-v180 .oc-chat-option button{border-color:transparent!important;background:transparent!important}\n#ramo-workspace-pane-v180 .oc-chat-option button:hover,#ramo-workspace-pane-v180 .oc-voice-row button:hover{background:var(--oc-hover)!important}\n#ramo-workspace-pane-v180 .oc-voice-message{color:var(--oc-muted)!important}\n#ramo-workspace-pane-v180 .ramo-w-actions{gap:5px!important;flex-wrap:wrap!important;justify-content:flex-end!important}\n#ramo-workspace-pane-v180 .ramo-w-newchat{font-weight:650!important;white-space:nowrap!important;color:var(--oc-text)!important}\n#ramo-workspace-pane-v180 .ramo-chat-scroll{scrollbar-color:var(--oc-rule) transparent!important}\n#ramo-workspace-pane-v180 .ramo-reading code{color:var(--oc-soft)!important;background:var(--oc-surface)!important}\n#ramo-nav-shell-v190 .ramo-drawer-chat-list{display:flex;flex-direction:column;gap:3px;overflow:auto;max-height:min(34vh,300px);padding:5px 1px;scrollbar-color:var(--oc-rule) transparent}\n#ramo-nav-shell-v190 .ramo-drawer-newchat{width:100%;display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer;background:var(--oc-surface);border:1px solid var(--oc-rule);border-radius:9px;padding:11px 12px;color:var(--oc-text);font:600 13px \"Segoe UI\",system-ui,sans-serif;margin:0 0 14px}\n#ramo-nav-shell-v190 .ramo-drawer-newchat:hover{background:var(--oc-hover)}\n#ramo-nav-shell-v190 .ramo-drawer-newchat svg{width:17px;height:17px;flex-shrink:0}\n#ramo-nav-shell-v190 .ramo-drawer-chat-heading{color:var(--oc-muted);font:600 11px \"Segoe UI\",system-ui,sans-serif;letter-spacing:.03em;padding:1px 9px 6px}\n#ramo-nav-shell-v190 .ramo-drawer-chat-entry{display:block;width:100%;border:0;border-radius:7px;background:transparent;color:var(--oc-soft);text-align:left;font:500 13px \"Segoe UI\",system-ui,sans-serif;padding:9px 11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}\n#ramo-nav-shell-v190 .ramo-drawer-chat-entry:hover{background:var(--oc-hover)}\n#ramo-nav-shell-v190 .ramo-drawer-chat-entry.active{color:var(--oc-text);background:var(--oc-surface)}\n#ramo-composer-v180{position:absolute}\n#ramo-composer-v180 .oc-stt-status{position:absolute;bottom:calc(100% + 9px);left:0;min-width:270px;max-width:min(560px,100%);border:1px solid var(--oc-rule);border-radius:11px;padding:11px 13px;display:flex;align-items:center;gap:11px;background:var(--oc-paper);color:var(--oc-text);box-shadow:0 9px 28px rgba(0,0,0,.34);font:13px \"Segoe UI\",system-ui,sans-serif;z-index:9}\n#ramo-composer-v180 .oc-stt-status[hidden]{display:none!important}\n#ramo-composer-v180 .oc-stt-dot{width:11px;height:11px;border-radius:50%;background:var(--oc-accent);flex:none}\n#ramo-composer-v180 .oc-stt-status[data-phase=\"listening\"] .oc-stt-dot{background:#e46f64;box-shadow:0 0 0 4px rgba(228,111,100,.14);animation:oc-stt-pulse .95s ease-in-out infinite alternate}\n#ramo-composer-v180 .oc-stt-status[data-phase=\"error\"] .oc-stt-dot{background:#e46f64}\n#ramo-composer-v180 .oc-stt-message{flex:1;min-width:0;overflow-wrap:anywhere;line-height:1.4}\n#ramo-composer-v180 .oc-stt-stop{border:1px solid var(--oc-rule);background:var(--oc-surface);color:var(--oc-text);border-radius:7px;padding:7px 10px;cursor:pointer;flex-shrink:0}\n#ramo-composer-v180[data-stt-active=\"1\"]{border-color:#e46f64!important;box-shadow:0 0 0 2px rgba(228,111,100,.16)!important}\n#ramo-composer-mic[data-stt-listening=\"1\"]{background:rgba(228,111,100,.17)!important;box-shadow:0 0 0 2px #e46f64!important;border-radius:9px!important}\n@keyframes oc-stt-pulse{to{opacity:.48;transform:scale(.7)}}\n@media(max-width:1000px){#ramo-workspace-pane-v180 .ramo-w-actions{gap:2px!important}#ramo-workspace-pane-v180 .ramo-w-actions .ramo-w-chats{display:none!important}}\n";
const OC_TURN_ACTIONS_CSS=`#ramo-workspace-pane-v180 .oc-message-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:9px}#ramo-workspace-pane-v180 .oc-message-actions button{background:transparent;border:0;padding:4px 3px;color:var(--oc-muted,#a6aba7);font:11px 'Segoe UI',system-ui,sans-serif;cursor:pointer;border-radius:4px}#ramo-workspace-pane-v180 .oc-message-actions button:hover{color:var(--oc-text,#fff);background:var(--oc-hover,#343839)}#ramo-workspace-pane-v180 .oc-turn-editor{margin-top:10px;display:grid;gap:9px}#ramo-workspace-pane-v180 .oc-turn-edit-input{display:block;width:100%;box-sizing:border-box;min-height:88px;max-height:260px;resize:vertical;background:var(--oc-surface,#2b2e30);border:1px solid var(--oc-rule,#45494b);border-radius:8px;color:var(--oc-text,#fff);padding:10px;font:13px/1.5 'Segoe UI',system-ui,sans-serif}#ramo-workspace-pane-v180 .oc-turn-edit-actions{display:flex;gap:8px}#ramo-workspace-pane-v180 .oc-turn-edit-actions button{border:1px solid var(--oc-rule,#45494b);background:var(--oc-surface,#2b2e30);color:var(--oc-text,#fff);padding:7px 13px;border-radius:7px;cursor:pointer}`;
if(typeof document!=='undefined'&&!document.getElementById('oc-turn-action-style')){const s=document.createElement('style');s.id='oc-turn-action-style';s.textContent=OC_TURN_ACTIONS_CSS;document.head.append(s);}
const OC_MODEL_DISCOVERY_CSS=`#ramo-composer-v180 .oc-model-refresh{display:block;width:100%;background:var(--oc-surface);border:1px solid var(--oc-rule);border-radius:8px;color:var(--oc-text);padding:8px 11px;margin:8px 0 5px;font:500 12px 'Segoe UI',sans-serif;cursor:pointer;text-align:left}#ramo-composer-v180 .oc-model-refresh:hover{background:var(--oc-hover)}#ramo-composer-v180 .oc-model-refresh:disabled{opacity:.6;cursor:wait}#ramo-composer-v180 .oc-model-refresh-note{font:11px 'Segoe UI',sans-serif;color:var(--oc-muted);line-height:1.35;padding:2px 1px 8px}`;
if(typeof document!=='undefined'&&!document.getElementById('oc-model-discovery-style')){const s=document.createElement('style');s.id='oc-model-discovery-style';s.textContent=OC_MODEL_DISCOVERY_CSS;document.head.append(s);}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
class RamoWorkspaceUI{
 constructor(){
  this.started=false;this.timer=null;this.syncTimer=null;this.resizeObserver=null;this.bgSkin=null;this.bgDrawable=null;this.bgGroup=null;
  this.overlayRoot=null;this.composer=null;this.workspacePane=null;this.workspaceContent=null;this.navShell=null;this.drawer=null;this.lastLayout=null;this.lastStageW=0;this.lastStageH=0;
  this.lastMic=-1;this.lastBusy=-1;this.lastHidden=-1;this.lastResponse='';this.suppressMirrorUntil=0;this.lastCanvasRect=null;this.auditTick=0;
  this.windowMode=false;this.artLayer=null;this.artBackdrop=null;this.artImages={};this.coreDom=null;this.coreOverride={};this.coreVisualKey="";this.coreMotion=null;this.coreFrame=null;this.lastCorePhase="";this.lastCoreJob="";this.lastLayoutWidth=0;this.lastLayoutHeight=0;
  this.ollamaInventory=[];this.ollamaInventoryOnline=false;this.ollamaInventoryError='';
  this.ollamaInventoryLast=0;this.ollamaInventoryPromise=null;
  this.currentPage='home';this.chatView={active:'main',chats:[],messages:[]};this.chatMenuOpen=false;this.chatViewStamp='';this.lastChatPoll=0;this.drawerOpen=false;this.hasAnswerLayout=false;this.theme=(()=>{try{return localStorage.getItem('ramo-theme-v1')==='paper'?'paper':'graphite';}catch(_){return'graphite';}})();this.navShell=null;this.drawer=null;this.ownerToken='ramo-1100-'+Math.random().toString(36).slice(2);this._resize=()=>this._syncViewport(false);this._stageResize=()=>this._schedule(true);this._stopAll=()=>this.dispose(false);
 }

 setCoreEffort(args){this.coreOverride.effort=String(args.EFFORT||'').toLowerCase();this._updateCoreState(true);}
 setCorePhase(args){this.coreOverride.phase=String(args.PHASE||'').toLowerCase();this._updateCoreState(true);}
 setCoreJob(args){this.coreOverride.job=String(args.JOB||'').toLowerCase();this._updateCoreState(true);}
 resetCore(){this.coreOverride={};this._updateCoreState(true);}
start(){if(this.started)return;this.started=true;globalThis.__ramoWorkspaceUIActive=this;this.windowMode=true;window.addEventListener('resize',this._resize);this._removeLegacyDom();this.apply(true);this.syncTimer=setInterval(()=>this._tick(),120);}
 refresh(){this.apply(true);}
 _schedule(full=true){if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;if(full)this.apply(true);else this._syncViewport(true);},80);}
dispose(){this.started=false;clearInterval(this.syncTimer);window.removeEventListener('resize',this._resize);this.overlayRoot?.remove();}
 _removeLegacyDom(){if(typeof document==='undefined')return;for(const id of ['ramo-stage-overlay-v173','ramo-stage-overlay-v180','ramo-composer-v170','ramo-response-workspace-v170','ramo-workspace-pane-v180','ramo-workspace-style-v170','ramo-workspace-style-v173','ramo-workspace-style-v180','ramo-nav-style-v190','ramo-nav-shell-v190']){const e=document.getElementById(id);if(e)try{e.remove();}catch(err){}}}




_findVarByName(name){return {get value(){return globalThis.RamoState.get(name)},set value(value){globalThis.RamoState.set(name,value)}};}
_getVar(id,def){return globalThis.RamoState.get(id)??def;}
_getNamed(name,def=''){return globalThis.RamoState.get(name)??def;}
_setVar(id,value){globalThis.RamoState.set(id,value);}

_fitStage(){this.windowMode=true;}
_stageDims(){return {stageW:window.innerWidth,stageH:window.innerHeight};}
 _layoutDims(){this._fitStage();if(this.windowMode){return{stageW:clamp(Math.round(window.innerWidth||BASE_W),260,4096),stageH:clamp(Math.round(window.innerHeight||BASE_H),280,4096)};}return this._stageDims();}
_rendererRect(){return {left:0,top:0,w:window.innerWidth,h:window.innerHeight};}
 _modeFor(w,h){const a=w/Math.max(1,h);if(w<520||h<340)return'COMPACT';if(w<900||a<1.22)return'STANDARD';if(w<1500||h<820)return'LARGE';return'XL';}
 _conversationOccupied(){
  const api=this._chatAPI?.(),view=this.chatView||{},session=api?.session,response=String(this._responseText?.()||'').trim();
  return !!view.busy||!!view.messages?.some(m=>String(m.user||m.assistant||'').trim())||!!(session&&(!session.chatId||session.chatId===view.active)&&session.turn?.raw)||!!(response&&!/^Ready[.!](?:\s|$)/i.test(response));
 }
 _geometry(stageW,stageH,mode){
  const w=stageW,h=stageH,isHome=this.currentPage==='home',aspect=w/Math.max(h,1);
  const margin=clamp(w*.020,12,32),rail=clamp(w*.053,48,60),drawerWidth=clamp(w*.19,205,255);
  const pushDrawer=this.windowMode&&w>=1040&&this.drawerOpen;
  const contentLeft=rail+margin+(pushDrawer?drawerWidth:0),usableRight=w-margin,span=usableRight-contentLeft;
  const occupied=this._conversationOccupied(),compact=w<690||h<440,sideBySide=occupied&&w>=960&&span>=700&&aspect>=1.30&&h>=450;
  const composerH=clamp(this.composerHeight||60,60,180),composerBottom=clamp(h*.022,7,22),workspaceBottom=composerBottom+composerH+clamp(h*.017,7,18);
  const coreDiameter=sideBySide?clamp(Math.min(h*.36,span*.22),128,430):clamp(Math.min(h*(compact?.29:.32),span*.56),128,315);
  const coreCenterX=sideBySide?contentLeft+span*.135:contentLeft+span*.50;
  const coreCenterY=sideBySide?clamp(h*.43,165,h*.53):clamp(h*(occupied?.24:.39),72,h*.45);
  const coreX=coreCenterX-w/2,coreY=h/2-coreCenterY;
  const guidePad=clamp(h*.02,6,23);
  const homeTop=coreCenterY+coreDiameter*.54+guidePad;
  const pageTop=clamp(h*.08,42,84);
  const workspaceLeft=sideBySide&&isHome?contentLeft+span*.29:contentLeft;
  const workspaceTop=isHome?(sideBySide?clamp(h*.105,58,96):occupied?Math.max(homeTop,h*.38):pageTop):pageTop;
  const workspaceRight=usableRight,workspaceWidth=Math.max(155,workspaceRight-workspaceLeft);
  const workspaceHeight=Math.max(55,h-workspaceTop-workspaceBottom);
  const coreSize=clamp(coreDiameter/104*100,75,620),activitySize=clamp(coreDiameter*.66/190*100,36,180),activityY=coreY+coreDiameter*.52;
  const composerLeft=sideBySide&&isHome?workspaceLeft:contentLeft,composerWidth=Math.max(180,usableRight-composerLeft),railButton=clamp(Math.min(rail*.72,h*.063),30,43);
  return{mode,compact,isHome,sideBySide,stageW:w,stageH:h,rail,margin,contentLeft,usableRight,coreCenterX,coreCenterY,coreX,coreY,coreDiameter,coreSize,activitySize,activityY,workspaceLeft,workspaceRight,workspaceTop,workspaceBottom,workspaceWidth,workspaceHeight,composerLeft,composerWidth,composerH,composerBottom,drawerWidth,railButton};
 }




/**
 * The one horizontal measurement of the surface: the room between the
 * sidebar and the docked right rail. The pane, the composer and the idle core
 * all derive from it, so nothing can be repositioned against a different
 * model of the same window.
 */
_contentBox(){
  const stageW=Math.max(260,Math.round(this.windowMode?(window.innerWidth||BASE_W):(this._rendererRect().w||BASE_W)));
  if(typeof document==='undefined')return {left:0,width:Math.min(916,Math.max(280,stageW-332)),right:0};
  const root=this.overlayRoot||document.getElementById('ramo-stage-overlay-v180');
  const reserve=root?.classList.contains('oc-rail-closed')?0:332;
  // The sidebar is docked above 900px and slides over the stage below it
  // (ramo-studio.css). Read the class, not a rect: a rect is mid-transition
  // when the window is resized and would hand back the previous width.
  const sidebar=document.getElementById('oc-studio-sidebar');
  const docked=sidebar&&stageW>900?216:0;
  const avail=Math.max(280,stageW-docked-reserve);
  const width=Math.min(916,avail);
  const left=Math.max(0,docked+Math.floor((avail-width)/2));
  return {left:Math.round(left),width:Math.round(width),right:Math.round(left+width)};
}
/** Publish the content box where the pane and composer read it. */
_publishContentBox(box){
  const root=this.overlayRoot||(typeof document!=='undefined'?document.getElementById('ramo-stage-overlay-v180'):null);
  if(!root)return box;
  const b=box||this._contentBox();
  root.style.setProperty('--oc-content-x',b.left+'px');
  root.style.setProperty('--oc-content-w',b.width+'px');
  root.style.setProperty('--oc-pane-left',b.left+'px');
  return b;
}
/** Re-apply the current geometry without re-rendering the conversation. */
_layoutNow(){
  if(!this.started)return;
  const dims=this._layoutDims(),mode=this._modeFor(dims.stageW,dims.stageH);
  this.lastStageW=dims.stageW;this.lastStageH=dims.stageH;
  const g=this._geometry(dims.stageW,dims.stageH,mode);this.lastLayout=g;
  this._positionOverlayRoot();this._publishContentBox();
  this._styleNavigation(g);this._styleComposer(g);this._styleWorkspace(g);this._styleArtwork(g);
}

_setVisible(){}
_applyLayout(g){for(const [key,id] of Object.entries(IDS))this._setVar(id,g[key]??g.mode);}

 _backgroundSvg(w,h,g){
  const light=this.theme==='paper',bg=light?'#f4f3ed':'#1f2123',rail=light?'#ecebe4':'#242628';
  const text=light?'#252b27':'#f4f3ee',muted=light?'#69756c':'#9ca6ac',line=light?'#d7ded6':'#34383b';
  const x=g.contentLeft+clamp(w*.01,4,18),y=clamp(h*.054,26,58),f=clamp(h*.027,16,25);
  const core=''; // The animated core already supplies visual geometry; no extra ghost frame. 
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/><rect x="0" y="0" width="${g.rail}" height="${h}" fill="${rail}"/><path d="M${g.rail} 0V${h}" stroke="${line}" stroke-width="1"/>${core}<g font-family="Segoe UI,Arial,sans-serif"><text x="${x}" y="${y}" fill="${text}" font-size="${f}" font-weight="650" letter-spacing="-.2">Ramo</text></g></svg>`;
 }
_ensureBackground(){}
_canvas(){return null;}
 _ensureOverlayRoot(){if(typeof document==='undefined')return null;let root=document.getElementById('ramo-stage-overlay-v180');if(!root){root=document.createElement('div');root.id='ramo-stage-overlay-v180';Object.assign(root.style,{position:'fixed',overflow:'hidden',pointerEvents:'none',zIndex:'2147482000',margin:'0',padding:'0',border:'0',boxSizing:'border-box'});document.body.appendChild(root);}this.overlayRoot=root;this._positionOverlayRoot();return root;}
 _positionOverlayRoot(){const root=this.overlayRoot;if(!root)return false;
  const r=this.windowMode?{left:0,top:0,w:Math.max(1,window.innerWidth),h:Math.max(1,window.innerHeight)}:this._rendererRect(),prev=this.lastCanvasRect;
  Object.assign(root.style,{left:r.left+'px',top:r.top+'px',width:r.w+'px',height:r.h+'px'});
  const changed=!prev||Math.abs(prev.left-r.left)>1||Math.abs(prev.top-r.top)>1||Math.abs(prev.w-r.w)>1||Math.abs(prev.h-r.h)>1;
  this.lastCanvasRect={left:r.left,top:r.top,w:r.w,h:r.h};return changed;
 }
 _watchViewport(){if(typeof ResizeObserver==='undefined')return;const c=this._canvas();if(!c)return;try{this.resizeObserver=new ResizeObserver(()=>this._syncViewport(true));this.resizeObserver.observe(c);}catch(e){}}
 _domScale(){const r=this.lastCanvasRect||(this.windowMode?{w:window.innerWidth,h:window.innerHeight}:this._rendererRect()),d=this.lastLayout||this._stageDims();return{sx:r.w/d.stageW,sy:r.h/d.stageH,w:r.w,h:r.h};}
 _coreState(){
  const research=Number(this._getNamed('Research Runtime Active',0))===1;
  const busy=Number(this._getVar('tamai_shell_busy_v1',0))===1;
  const mic=Number(this._getVar('tamai_shell_mic_in_v1',0))===1;
  const activity=String(this._getNamed('Core Activity',this._getVar('v28_4_core_activity','READY'))||'READY').toUpperCase();
  const meter=globalThis.__ramoInferenceMeter;
  const active=meter?.active?Object.values(meter.active).sort((a,b)=>(b.seq||0)-(a.seq||0))[0]:null;
  const configuredModel=research?this._getNamed('Research Report Model',''):this._getNamed('Assistant Model','');
  const model=String(this.coreOverride.model||active?.model||configuredModel);
  let job=research?'research':/MEMORY|RECALL/.test(activity)?'memory':/SEARCH/.test(activity)?'research':this.currentPage==='files'?'files':'chat';
  if(active&&/memory/i.test(active.lane))job='memory';
  if(this.coreOverride.job)job=this.coreOverride.job;
  let phase='idle';
  if(/ERROR|FAIL/.test(activity))phase='error';
  else if(mic||/SPEAK|LISTEN/.test(activity))phase='speak';
  else if(active?.phase){phase=active.phase;}
  else if(active){phase=active.think==='on'||active.think==='high'?'think':/extract|fetch/i.test(active.lane)?'search':'generate';}
  else if(/SEARCH|FETCH|RETRIEV|\bREAD(?:ING)?\b/.test(activity)||research)phase='search';
  else if(/MEMORY|RECALL/.test(activity))phase='memory';
  else if(/GENERAT|RESPOND|WRITE|ANSWER/.test(activity)||busy)phase='generate';
  else if(/THINK|DEEP|PLANN/.test(activity))phase='think';
  if(this.coreOverride.phase)phase=this.coreOverride.phase;
  // Unlike previous activity-label-only estimation, active model effort is derived
  // from its request's reasoning option and approximate actual input size. The
  // configured context maximum does NOT count as work. Provider usage replaces
  // the estimate when the call ends, if the backend reports it.
  let effort=phase==='idle'?0:1;
  if(active){
    const n=Math.max(0,Number(active.inputTokens)||0);
    effort=n<1800?1:n<12000?2:n<48000?3:4;
    if(active.think==='on')effort=Math.min(4,effort+1);
    else if(active.think==='high')effort=Math.min(4,effort+2);
  }
  const explicit=String(this.coreOverride.effort||this._getNamed('Core Effort Level','')).toLowerCase();
  if(explicit){const levels={idle:0,light:1,medium:2,high:3,extreme:4,'very high':4};if(Object.hasOwn(levels,explicit))effort=levels[explicit];}
  const id=model.toLowerCase();
  const primary=id.includes('bonsai')?'#8ff15a':id.includes('35b')||id.includes('qwen36')||id.includes('qwen3.6')?'#ffcf54':id.includes('9b')?'#51dad1':id.includes('4b')?'#5cecac':'#8fe8a6';
  const jobColors={chat:'#eff16b',research:'#4bc6ff',memory:'#ffab64',files:'#bba3fd'};
  const secondary=({think:'#b89aff',generate:'#6ee8bf',search:'#4bc6ff',memory:'#ffab64',error:'#ff7a8c',speak:'#f3b968'})[phase]||jobColors[job]||'#9dbef7';
  return{job,model,phase,effort,primary,secondary,activity,workload:active||null};
 }
 _makeCoreSvg(){
   // ASTER: only its authored SVG geometry remains, not the study's page, controls, or simulator.
   return "<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"oc-core-svg oc-aster-svg\" viewBox=\"0 0 560 560\" preserveAspectRatio=\"xMidYMid meet\" role=\"presentation\" aria-label=\"Precise segmented luminous circular assistant presence, with independently elastic arcs and luminous inner nucleus\" style=\"--model:#6d86ff;--aura1:#dff7ff;--aura2:#99b8d8;--auraStroke:#bbd1e2\">\n      <defs>\n        <radialGradient id=\"ocAsterHaloFade\">\n          <stop offset=\"0\" stop-color=\"var(--aura1)\" stop-opacity=\".34\"/>\n          <stop offset=\".35\" stop-color=\"var(--aura1)\" stop-opacity=\".14\"/>\n          <stop offset=\".72\" stop-color=\"var(--aura2)\" stop-opacity=\".05\"/>\n          <stop offset=\"1\" stop-color=\"var(--aura2)\" stop-opacity=\"0\"/>\n        </radialGradient>\n        <filter id=\"ocAsterBloom\" x=\"-50%\" y=\"-70%\" width=\"200%\" height=\"240%\"><feGaussianBlur stdDeviation=\"5.2\"/></filter>\n      </defs>\n      \n      <g transform=\"translate(280 280)\">\n        <circle class=\"primary-track\" r=\"187\"/>\n      </g>\n      \n      <g transform=\"translate(280 280)\" id=\"ocAsterOuter\">\n        <g class=\"outer-piece\" data-i=\"0\" data-angle=\"0\" transform=\"rotate(0)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"1\" data-angle=\"30\" transform=\"rotate(30)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"2\" data-angle=\"60\" transform=\"rotate(60)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"3\" data-angle=\"90\" transform=\"rotate(90)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"4\" data-angle=\"120\" transform=\"rotate(120)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"5\" data-angle=\"150\" transform=\"rotate(150)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"6\" data-angle=\"180\" transform=\"rotate(180)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"7\" data-angle=\"210\" transform=\"rotate(210)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"8\" data-angle=\"240\" transform=\"rotate(240)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"9\" data-angle=\"270\" transform=\"rotate(270)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"10\" data-angle=\"300\" transform=\"rotate(300)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n        <g class=\"outer-piece\" data-i=\"11\" data-angle=\"330\" transform=\"rotate(330)\"><path class=\"segment-bloom\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/><path class=\"segment-face\" d=\"M-34 -184 A187 187 0 0 1 34 -184\"/></g>\n      </g>\n      \n      <g transform=\"translate(280 280)\" id=\"ocAsterInner\">\n        <g class=\"inner-piece\" data-i=\"0\" data-angle=\"0\" transform=\"rotate(0)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"1\" data-angle=\"45\" transform=\"rotate(45)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"2\" data-angle=\"90\" transform=\"rotate(90)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"3\" data-angle=\"135\" transform=\"rotate(135)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"4\" data-angle=\"180\" transform=\"rotate(180)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"5\" data-angle=\"225\" transform=\"rotate(225)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"6\" data-angle=\"270\" transform=\"rotate(270)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n        <g class=\"inner-piece\" data-i=\"7\" data-angle=\"315\" transform=\"rotate(315)\"><path class=\"inner-bloom\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/><path class=\"inner-face\" d=\"M-18 -138 A139 139 0 0 1 18 -138\"/></g>\n      </g>\n      \n      <g id=\"ocAsterAlive\" transform=\"translate(280 280)\">\n        <circle class=\"core-halo\" r=\"98\"/>\n        <circle class=\"core-body\" r=\"28\"/>\n        <circle class=\"core-innerglow\" r=\"17\"/>\n        <circle class=\"core-center\" r=\"9.2\"/>\n        <circle class=\"wave-ripple\" id=\"ocAsterRipple\" r=\"62\"/>\n      </g>\n    </svg>";
 }
 _beginCoreMotion(){
   if(this.coreFrame!==null||!this.coreDom||typeof requestAnimationFrame!=='function')return;
   const svg=this.coreDom.querySelector('.oc-aster-svg'); if(!svg)return;
   const outer=[...svg.querySelectorAll('.outer-piece')].map((el,i)=>({el,i,angle:Number(el.dataset.angle),position:0,velocity:0}));
   const inner=[...svg.querySelectorAll('.inner-piece')].map((el,i)=>({el,i,angle:Number(el.dataset.angle)}));
   const outerGroup=svg.querySelector('#ocAsterOuter'),innerGroup=svg.querySelector('#ocAsterInner');
   const core=svg.querySelector('#ocAsterAlive'),halo=svg.querySelector('.core-halo'),ripple=svg.querySelector('#ocAsterRipple');
   if(outer.length!==12||inner.length!==8||!outerGroup||!innerGroup||!core||!halo||!ripple)return;
   const pairColors={fast:['#ffe24d','#54ff77'],medium:['#41e2ff','#4f7cff'],strong:['#5564ff','#9a55ff'],moe:['#ff52be','#ff855f']};
   const moodColors={calm:['#9bf5d6','#5fbfbe'],attentive:['#d7f0ff','#87b7ff'],curious:['#cfb7ff','#73e3ff'],alert:['#ffd67f','#ff7ea6']};
   const rgb=v=>[parseInt(v.slice(1,3),16),parseInt(v.slice(3,5),16),parseInt(v.slice(5,7),16)];
   const lerp=(a,b,t)=>a+(b-a)*t,blend=(a,b,t)=>a.map((v,i)=>lerp(v,b[i],t));
   const rgbCss=a=>`rgb(${a.map(v=>Math.round(v)).join(',')})`;
   const nearby=(a,b,n)=>{const d=Math.abs(a-b);return Math.min(d,n-d)};
   const gaze=[{x:0,y:0,hold:.55},{x:8,y:-4,hold:.85},{x:-6,y:-6,hold:.9},{x:6,y:4,hold:.8},{x:-8,y:3,hold:.95},{x:2,y:7,hold:.75},{x:0,y:0,hold:.6}];
   const motion=this.coreMotion={outer,inner,svg,outerGroup,innerGroup,core,ripple,halo,
     mode:'idle',model:'medium',mood:'attentive',modeBlend:{idle:1,thinking:0,generating:0,tool:0},
     currentColor:rgb('#5c86ff'),currentAura1:rgb('#d7f0ff'),currentAura2:rgb('#87b7ff'),
     last:null,seconds:0,outerAngle:0,innerAngle:0,gazeIndex:0,gazeElapsed:0,gazeX:0,gazeY:0,
     waveStarted:-1e9,waveOrigin:0,pointerIndex:-1,pointerId:null,pointerRadial:0};
   const coords=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const ctm=svg.getScreenCTM();if(!ctm)return null;
     const q=p.matrixTransform(ctm.inverse()),dx=q.x-280,dy=q.y-280;
     return {r:Math.hypot(dx,dy),angle:((Math.atan2(dx,-dy)*180/Math.PI)+360)%360};};
   const nearest=angle=>((Math.round((angle-motion.outerAngle)/30)%12)+12)%12;
   svg.addEventListener('pointerdown',e=>{const c=coords(e);if(!c)return;
     if(c.r>144&&c.r<228){motion.pointerIndex=nearest(c.angle);motion.pointerRadial=Math.max(-30,Math.min(30,c.r-187));motion.pointerId=e.pointerId;svg.classList.add('dragging');svg.setPointerCapture(e.pointerId);}
     else{motion.waveStarted=performance.now();motion.waveOrigin=nearest(c.angle);}});
   svg.addEventListener('pointermove',e=>{if(motion.pointerId!==e.pointerId)return;const c=coords(e);if(c)motion.pointerRadial=Math.max(-32,Math.min(32,c.r-187));});
   const stopDrag=e=>{if(e&&motion.pointerId!==e.pointerId)return;motion.pointerId=null;motion.pointerIndex=-1;motion.pointerRadial=0;svg.classList.remove('dragging')};
   svg.addEventListener('pointerup',stopDrag);svg.addEventListener('pointercancel',stopDrag);svg.addEventListener('lostpointercapture',()=>stopDrag(null));
   const reduced=()=>{try{return matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(_){return false;}};
   const frame=(now)=>{
     if(!this.started||this.coreMotion!==motion||!this.coreDom||!this.coreDom.isConnected){this.coreFrame=null;return;}
     const dt=motion.last===null?0:Math.min(.035,Math.max(0,(now-motion.last)/1000));motion.last=now;
     if(document.hidden||this.coreDom.style.display==='none'||reduced()){this.coreFrame=requestAnimationFrame(frame);return;}
     motion.seconds+=dt;const seconds=motion.seconds,mode=motion.mode,mood=motion.mood,model=motion.model;
     const targets={idle:0,thinking:0,generating:0,tool:0};targets[mode]=1;
     for(const k of Object.keys(targets))motion.modeBlend[k]+=(targets[k]-motion.modeBlend[k])*Math.min(1,dt*6.5);
     const {idle:idleW,thinking:thinkW,generating:genW,tool:toolW}=motion.modeBlend;
     const modelPair=motion.colors||pairColors[model],moodPair=motion.activityColors||moodColors[mood];
     const modelPulse=.5+.32*Math.sin(seconds*(model==='fast'?.26:model==='medium'?.2:model==='strong'?.17:.23));
     const targetColor=blend(rgb(modelPair[0]),rgb(modelPair[1]),modelPulse);
     const targetAura1=blend(rgb(moodPair[0]),targetColor,mood==='alert'?.26:mood==='curious'?.18:.1);
     const targetAura2=blend(rgb(moodPair[1]),targetColor,mood==='alert'?.18:mood==='curious'?.13:.06);
     const k=Math.min(1,dt*3.1);
     motion.currentColor=blend(motion.currentColor,targetColor,k);
     motion.currentAura1=blend(motion.currentAura1,targetAura1,k);
     motion.currentAura2=blend(motion.currentAura2,targetAura2,k);
     svg.style.setProperty('--model',rgbCss(motion.currentColor));
     svg.style.setProperty('--aura1',rgbCss(motion.currentAura1));
     svg.style.setProperty('--aura2',rgbCss(motion.currentAura2));
     svg.style.setProperty('--auraStroke',rgbCss(motion.currentAura2));
     const breath=Math.sin(seconds*(idleW+1.65*thinkW+2.2*genW+1.35*toolW+(mood==='calm'?-.1:0)));
     // Output animation reflects the real generation state, not fabricated throughput or token counts.
     const outputPulse=(Math.sin(seconds*2*Math.PI*1.5)+1)/2;
     const outerSpeed=.17*idleW+.26*thinkW+.42*genW+.68*toolW;
     const innerSpeed=.20*idleW+.63*thinkW+.48*genW+1.8*toolW;
     motion.outerAngle=(motion.outerAngle+outerSpeed*dt*180/Math.PI)%360;
     motion.innerAngle=(motion.innerAngle-innerSpeed*dt*180/Math.PI)%360;
     const outerScale=1+idleW*.002+thinkW*(.013+.008*(.5+.5*Math.sin(seconds*2.2)))+genW*(.020+.014*outputPulse)+toolW*.004;
     outerGroup.setAttribute('transform',`translate(280 280) rotate(${motion.outerAngle.toFixed(3)}) scale(${outerScale.toFixed(4)})`);
     innerGroup.setAttribute('transform',`translate(280 280) rotate(${motion.innerAngle.toFixed(3)})`);
     const nowWave=(now-motion.waveStarted)/1000;
     for(const piece of outer){
       let target=.45*idleW*breath+genW*(1.1+3.6*outputPulse);
       if(thinkW>.001){const head=(seconds*5.8)%12;
         target+=thinkW*(10.2*Math.exp(-Math.pow(nearby(piece.i,head,12),2)/1.35)+9.1*Math.exp(-Math.pow(nearby(piece.i,(head+6)%12,12),2)/1.35)+1.25*Math.sin(seconds*3.5+piece.i*.48));}
       if(toolW>.001){const d=nearby(piece.i,(seconds*.7)%12,12);target+=toolW*1.6*Math.exp(-d*d/1.2);}
       if(nowWave>=0&&nowWave<2.2){const arrival=nowWave-nearby(piece.i,motion.waveOrigin,12)*.15;
         target+=14*Math.exp(-Math.pow((arrival-.16)/.18,2))*Math.sin(Math.PI*Math.max(0,Math.min(1,arrival/.34)));}
       if(motion.pointerIndex>=0){const d=nearby(piece.i,motion.pointerIndex,12);target+=motion.pointerRadial*Math.exp(-d*d/1.3);}
       piece.velocity+=(target-piece.position)*75*dt;
       piece.velocity*=Math.exp(-12.6*dt);piece.position+=piece.velocity*dt;
       const amount=Math.max(-32,Math.min(32,piece.position));
       piece.el.setAttribute('transform',`rotate(${piece.angle}) translate(0 ${(-amount).toFixed(3)})`);
       const phase=seconds*(.35*idleW+1.6*thinkW+1.3*genW+2*toolW)+piece.i*(.52*genW-.2*idleW-.45*toolW);
       const head=(seconds*5.8)%12;
       const crestLight=thinkW*(.12*Math.exp(-Math.pow(nearby(piece.i,head,12),2)/1.35)+.12*Math.exp(-Math.pow(nearby(piece.i,(head+6)%12,12),2)/1.35));
       const bright=.02*idleW+.10*thinkW+crestLight+genW*(.18+.22*(.5+.5*Math.sin(phase)))+toolW*(.05+.1*(.5+.5*Math.sin(phase)));
       piece.el.querySelector('.segment-face').style.opacity=(.66+bright).toFixed(3);
       piece.el.querySelector('.segment-bloom').style.strokeOpacity=(.1+genW*.24+toolW*.08+thinkW*.18).toFixed(3);
     }
     for(const piece of inner){
       const phase=seconds*(.4*idleW+3.2*thinkW+1.8*genW+7.2*toolW)-piece.i*.78;
       const signal=(Math.sin(phase)+1)/2;
       const alpha=.1*idleW+(.28+.65*signal)*thinkW+(.18+.95*signal)*toolW+(.16+.28*signal)*genW;
       piece.el.querySelector('.inner-face').style.opacity=alpha.toFixed(3);
       piece.el.querySelector('.inner-bloom').style.opacity=(alpha*(.38+.2*thinkW+.34*toolW)).toFixed(3);
       const lift=1.8*signal*thinkW+2.8*signal*toolW+.85*signal*genW+.08*signal*idleW;
       piece.el.setAttribute('transform',`rotate(${piece.angle}) translate(0 ${(-lift).toFixed(3)})`);
     }
     let coreScale=1+(.006*idleW+.012*thinkW+.018*genW+.014*toolW)*breath;
     if(mood==='curious')coreScale+=.028*Math.sin(seconds*2.8);
     if(mood==='calm')coreScale=1+.006*Math.sin(seconds*.95);
     if(mood==='alert')coreScale+=.014*Math.sin(seconds*4);
     if(genW>.001)coreScale+=.038*outputPulse*genW;
     if(toolW>.001)coreScale+=.012*(.5+.5*Math.sin(seconds*5.5))*toolW;
     halo.style.opacity=(.18+.08*idleW+.18*thinkW+.28*genW+.25*toolW+(mood==='alert'?.1:0)+(mood==='curious'?.05:0)).toFixed(3);
     ripple.style.strokeOpacity=(nowWave>=0&&nowWave<1.6?.38*(1-Math.min(1,nowWave/1.6)):0).toFixed(3);
     ripple.setAttribute('r',(62+Math.min(120,nowWave>0?nowWave*110:0)).toFixed(2));
     if(mode==='tool'){
       motion.gazeElapsed+=dt;
       if(motion.gazeElapsed>=gaze[motion.gazeIndex].hold){motion.gazeElapsed=0;motion.gazeIndex=(motion.gazeIndex+1)%gaze.length;}
     }else{motion.gazeIndex=0;motion.gazeElapsed=0;}
     const destination=gaze[motion.gazeIndex],ease=1-Math.exp(-dt*8.4);
     motion.gazeX+=(destination.x*toolW-motion.gazeX)*ease;
     motion.gazeY+=(destination.y*toolW-motion.gazeY)*ease;
     core.setAttribute('transform',`translate(${(280+motion.gazeX).toFixed(3)} ${(280+motion.gazeY).toFixed(3)}) rotate(${(motion.innerAngle*.35).toFixed(3)}) scale(${coreScale.toFixed(4)})`);
     this.coreFrame=requestAnimationFrame(frame);
   };
   this.coreFrame=requestAnimationFrame(frame);
 }
 _updateCoreState(force=false){
   const state=this._coreState(),root=this.coreDom;if(!root)return;
   const live=state.workload;
   const key=[state.model,state.job,state.phase,state.effort,live?.id||'',live?.inputTokens||0,live?.think||''].join(':');
   if(!force&&key===this.coreVisualKey)return;
   this.coreVisualKey=key;root.dataset.phase=state.phase;root.dataset.job=state.job;root.dataset.model=state.model;root.setAttribute('aria-label',state.model+' · '+state.phase);
   const svg=root.querySelector('.oc-aster-svg');if(svg){svg.style.setProperty('--model',state.primary);svg.style.setProperty('--aura1',state.secondary);svg.style.setProperty('--aura2',state.primary);svg.style.setProperty('--auraStroke',state.secondary);}
   const levels=['idle','light','medium','high','extreme'];
   const context=live?(live.estimated?'~':'')+Number(live.inputTokens||0).toLocaleString()+' input tokens':'';
   const reasoning=live?(live.think==='unspecified'?'thinking unspecified':live.think==='off'?'thinking off':'thinking '+live.think):'';
   root.title=[state.model,state.job,state.phase,levels[state.effort]+' effort',reasoning,context].filter(Boolean).join(' · ');
   this._beginCoreMotion();
   const motion=this.coreMotion;
   if(motion){
     motion.colors=[state.primary,state.secondary];motion.activityColors=[state.secondary,state.primary];
     const id=state.model.toLowerCase();
     motion.model=/(moe|a3b|a22b|a2b|experts|mixtral|gpt-oss)/i.test(id)?'moe':/(35b|27b|32b|70b|72b|80b|strong|qwen36|qwen3\.6)/i.test(id)?'strong':/(9b|12b|14b|medium)/i.test(id)?'medium':'fast';
     motion.mode=state.phase==='think'?'thinking':state.phase==='search'||state.phase==='memory'?'tool':state.phase==='generate'||state.phase==='speak'?'generating':'idle';
     motion.mood=state.phase==='error'?'alert':state.phase==='memory'?'curious':state.phase==='idle'?'calm':'attentive';
   }
   const captions={idle:'Ready',search:'Searching',memory:'Recalling',think:'Thinking',generate:'Responding',speak:'Listening',error:'Attention needed'};
   const caption=root.querySelector('.oc-core-caption');if(caption)caption.textContent=captions[state.phase]||'Working';
   const note=root.querySelector('.oc-core-note');if(note)note.textContent=live?state.model+' · '+levels[state.effort]+' · '+context:state.model+' · '+state.job;
   const shell=this.navShell;if(shell){shell.style.setProperty('--core-primary',state.primary);shell.style.setProperty('--mini-dur','45s');}
   this.lastCorePhase=state.phase;
 }
 _styleArtwork(g){
  if(!this.overlayRoot||!g)return;
  if(!this.artLayer){
   const layer=document.createElement('div');layer.id='ramo-window-art-v210';
   Object.assign(layer.style,{position:'absolute',inset:'0',zIndex:'0',pointerEvents:'none',overflow:'hidden'});
   const backdrop=document.createElement('div');backdrop.className='ramo-window-backdrop';Object.assign(backdrop.style,{position:'absolute',inset:'0',overflow:'hidden'});
   const core=document.createElement('div');core.id='ramo-core-layer';core.setAttribute('role','img');core.setAttribute('aria-label','Ramo activity core');core.innerHTML=this._makeCoreSvg()+'<div class="oc-core-caption" aria-hidden="true">Ready</div><div class="oc-core-note" aria-hidden="true"></div>';
   layer.append(backdrop,core);this.overlayRoot.insertBefore(layer,this.overlayRoot.firstChild);
   this.artLayer=layer;this.artBackdrop=backdrop;this.coreDom=core;
  }
  this.artLayer.style.display='block';
  this.artBackdrop.style.display=this.windowMode?'block':'none';
  const m=this._domScale(),W=Math.round(g.stageW*m.sx),H=Math.round(g.stageH*m.sy);
  if(this.windowMode){const stamp=[W,H,g.contentLeft,this.currentPage,this.theme,g.coreCenterX,g.coreCenterY,g.coreDiameter].join(':');
   if(this.artBackdrop.dataset.stamp!==stamp){this.artBackdrop.innerHTML=this._backgroundSvg(g.stageW,g.stageH,g).replace('<svg ','<svg style="width:100%;height:100%;display:block" ');this.artBackdrop.dataset.stamp=stamp;}
  }
  const c=this.coreDom;c.style.display=g.isHome?'block':'none';
  if(g.isHome){const d=g.coreDiameter*Math.min(m.sx,m.sy),x=g.coreCenterX*m.sx-d/2,y=g.coreCenterY*m.sy-d/2;Object.assign(c.style,{left:x+'px',top:y+'px',width:d+'px',height:d+'px'});}
  this._updateCoreState();
 }

 _syncViewport(restyle=true){if(!this.started)return;const d=this._layoutDims();if(d.stageW!==this.lastStageW||d.stageH!==this.lastStageH){this.apply(true);return;}const changed=this._positionOverlayRoot();if(changed||restyle)this._layoutNow();}
 _findPIInput(){if(typeof document==='undefined')return null;const d=document.getElementById('ui-prompt');if(d){if(d.tagName==='INPUT'||d.tagName==='TEXTAREA')return d;const c=d.querySelector&&d.querySelector('input,textarea');if(c)return c;}for(const n of document.querySelectorAll('input,textarea')){const id=n.id||'',name=n.getAttribute('name')||'',p=(n.getAttribute('placeholder')||'').toLowerCase();if(id==='ui-prompt'||id.endsWith('ui-prompt')||name==='ui-prompt'||p.includes('ask ramo')||p.includes('type a command'))return n;}return null;}
 _findPI(id){if(typeof document==='undefined')return null;let e=document.getElementById(id);if(e)return e;for(const n of document.querySelectorAll('[id],[data-id],[name]')){const nid=n.id||'',nm=n.getAttribute('name')||'';if(nid===id||nid.endsWith(id)||nm===id)return n;}return null;}
_hideProjectPrompt(){return true;}
_writeProjectPrompt(value){globalThis.RamoState.set('UI_TEXT_IN',value);return true;}
_readProjectPrompt(){return globalThis.RamoState.get('UI_TEXT_IN')||'';}
_startSpriteClick(name){const api=this._chatAPI();const actions={'Chat Button':()=>api.askAI({TEXT:this._readProjectPrompt()}),'Attach Text':()=>api.openResearch(),'Memory Browser':()=>api.openMemories(),'Text Workspace':()=>api.openFiles(),'Info':()=>api.openHistory(),'Help':()=>api.openHub(),'Voice Mode':()=>this._toggleLocalDictation()};Promise.resolve().then(actions[name]||(()=>{})).catch(e=>this._showSmallStatus(e.message));}
 _resizeComposer(){
  const input=this.composer?.querySelector('#ramo-command-input-v180');if(!input)return;
  input.style.height='24px';const height=Math.max(24,Math.min(140,input.scrollHeight));input.style.height=height+'px';input.style.overflowY=height>=140?'auto':'hidden';
  const expanded=height>36;this.composer.dataset.expanded=String(expanded);const next=expanded?height+54:60;
  if(next!==this.composerHeight){this.composerHeight=next;this.apply(true);}
 }
_sendComposer(){const input=document.getElementById('ramo-command-input-v180');const api=this._chatAPI();if(api?.session&&!input.value.trim()){api.cancel();return;}if(api?.session){globalThis.RamoApplication.enqueue(input.value,api.pendingDocument);input.value='';return;}const value=input?.value||'';if(!value.trim()&&!api.pendingDocument)return;this._writeProjectPrompt(value);input.value='';this._resizeComposer();this._startSpriteClick('Chat Button');}

 _navIcon(key){
  const common='viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  if(key==='home')return '<svg class="ramo-mini-core" xmlns="http://www.w3.org/2000/svg" '+common+'><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><g class="oc-mini-ring"><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="2" stroke-dasharray="11 4 7 4 8 13"/></g></svg>';
  const d={menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',research:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 4.8 4.8"/>',memory:'<circle cx="6.5" cy="7" r="2.2"/><circle cx="17.5" cy="8" r="2.2"/><circle cx="11.5" cy="18" r="2.2"/><path d="m8.4 8.4 7 0M7.5 9l3 7m6-6-4 6"/>',files:'<path d="M7 3.5h7l4 4v13H7zM14 3.5v4h4M10 12h5M10 16h5"/>',computer:'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h8"/>',models:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 15h8"/><circle cx="11" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1" fill="currentColor" stroke="none"/>',archive:'<path d="M4 11a8 8 0 1 1 1.6 6M4 5v6h6"/><path d="M12 7.5v5l3.3 2"/>',system:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--oc-nav)"/><circle cx="15" cy="12" r="2" fill="var(--oc-nav)"/><circle cx="8" cy="18" r="2" fill="var(--oc-nav)"/>',appearance:'<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5m11.2 11.2 1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5"/>',voice:'<rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6.5 12c0 4 2.5 6 5.5 6s5.5-2 5.5-6M12 18v3"/>',more:'<circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/>'};return `<svg xmlns="http://www.w3.org/2000/svg" ${common}>${d[key]||d.more}</svg>`;
 }
 _navAction(page){
  if(window.ramoDesktop?.pages){if(page==='computer'||page==='models'){window.ramoDesktop.pages.open(page);return;}window.dispatchEvent(new CustomEvent('ramo:desktop-page-close'));}
  if(page==='home'){this._requestHome();return;}
  const map={research:'Attach Text',memory:'Memory Browser',files:'Text Workspace',archive:'Info',system:'Help'};
  if(map[page])this._startSpriteClick(map[page]);
 }
 _toggleDrawer(force){this.drawerOpen=typeof force==='boolean'?force:!this.drawerOpen;if(this.drawer)this.drawer.classList.toggle('is-open',this.drawerOpen);if(this.navShell)this.navShell.classList.toggle('drawer-open',this.drawerOpen);if(this.started&&this.windowMode)this.apply(true);}
 _setupNavigation(){
  if(typeof document==='undefined')return false;const host=this._ensureOverlayRoot();if(!host)return false;let shell=document.getElementById('ramo-nav-shell-v190');
  if(!shell){
    shell=document.createElement('div');shell.id='ramo-nav-shell-v190';
    shell.innerHTML=`<nav class="ramo-rail" aria-label="Ramo navigation">
      <button class="ramo-rail-btn ramo-menu" data-act="drawer" aria-label="Open navigation">${this._navIcon('menu')}</button>
      <button class="ramo-rail-btn" data-page="home" aria-label="Assistant">${this._navIcon('home')}</button>
      <div class="ramo-rail-spacer"></div>
      <button class="ramo-rail-btn" data-page="research" aria-label="Research">${this._navIcon('research')}</button>
      <button class="ramo-rail-btn" data-page="memory" aria-label="Memory">${this._navIcon('memory')}</button>
      <button class="ramo-rail-btn" data-page="files" aria-label="Files">${this._navIcon('files')}</button>
      <div class="ramo-rail-flex"></div>
      <button class="ramo-rail-btn" data-page="computer" aria-label="Computer">${this._navIcon('computer')}</button>
      <button class="ramo-rail-btn" data-page="models" aria-label="Models">${this._navIcon('models')}</button>
      <button class="ramo-rail-btn" data-page="system" aria-label="System and model settings">${this._navIcon('system')}</button>
    </nav>
    <aside class="ramo-drawer" aria-label="Ramo navigation drawer">
      <div class="ramo-drawer-head"><div><b>Ramo</b><span>Personal assistant</span></div><button class="ramo-close" data-act="drawer" aria-label="Close navigation">×</button></div>
      <button class="ramo-assistant-btn" data-page="home">${this._navIcon('home')}<span><b>Assistant</b><small>Core and current conversation</small></span></button>
      <button class="ramo-drawer-newchat" data-act="new-chat" title="Start a new conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>New chat</button><div class="ramo-drawer-chat-heading">Recent chats</div><div class="ramo-drawer-chat-list" aria-label="Recent conversations"></div><div class="ramo-section-label">PAGES</div>
      <button class="ramo-drawer-btn" data-page="research">${this._navIcon('research')}<span><b>Research</b><small>Deep research and saved reports</small></span></button>
      <button class="ramo-drawer-btn" data-page="memory">${this._navIcon('memory')}<span><b>Memory</b><small>Recall and saved context</small></span></button>
      <button class="ramo-drawer-btn" data-page="files">${this._navIcon('files')}<span><b>Files</b><small>Documents and local text</small></span></button>
      <button class="ramo-drawer-btn" data-page="archive">${this._navIcon('archive')}<span><b>Archive</b><small>Previous conversations</small></span></button>
      <button class="ramo-drawer-btn" data-page="computer">${this._navIcon('computer')}<span><b>Computer</b></span></button>
      <button class="ramo-drawer-btn" data-page="models">${this._navIcon('models')}<span><b>Models</b></span></button>
      <button class="ramo-drawer-btn" data-page="system">${this._navIcon('system')}<span><b>System</b><small>Settings and diagnostics</small></span></button>
      <div class="ramo-nav-separator"></div>
      <button class="ramo-theme-switch" data-act="theme" aria-label="Toggle light and graphite appearance">${this._navIcon('appearance')}<span><b>Appearance</b><span class="ramo-theme-name">Graphite appearance</span></span></button>
      <div class="ramo-drawer-context"><span>CURRENT PAGE</span><b class="ramo-current-page">Conversation</b></div>
    </aside>`;
    host.appendChild(shell);
    shell.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.act==='drawer'){this._toggleDrawer();return;}if(b.dataset.act==='theme'){this._toggleTheme();return;}if(b.dataset.act==='new-chat'){this._doChatAction('new');if(window.innerWidth<1150)this._toggleDrawer(false);return;}if(b.dataset.chatId){this._doChatAction('select',b.dataset.chatId);if(window.innerWidth<1150)this._toggleDrawer(false);return;}if(b.dataset.act==='mic'){this._toggleLocalDictation();return;}const p=b.dataset.page;if(p){this._navAction(p);if(window.innerWidth<1150)this._toggleDrawer(false);}});
    this.navShell=shell;this.drawer=shell.querySelector('.ramo-drawer');this._ensureNavStyle();
  }else{this.navShell=shell;this.drawer=shell.querySelector('.ramo-drawer');}
  shell.classList.toggle('drawer-open',this.drawerOpen);this.drawer?.classList.toggle('is-open',this.drawerOpen);this._syncNavState();this._renderDrawerChats();return true;
 }
 _ensureNavStyle(){
  if(typeof document==='undefined'||document.getElementById('ramo-nav-style-v190'))return;const s=document.createElement('style');s.id='ramo-nav-style-v190';
  s.textContent=`#ramo-nav-shell-v190{position:absolute;inset:0;pointer-events:none;z-index:2147483400;font-family:Arial,Helvetica,sans-serif;color:#dff5ff}#ramo-nav-shell-v190 *{box-sizing:border-box}
#ramo-nav-shell-v190 .ramo-rail{position:absolute;left:0;top:0;bottom:0;width:var(--rail-w,56px);background:rgba(7,20,28,.985);border-right:1px solid #183541;display:flex;align-items:center;flex-direction:column;padding:10px 0;gap:8px;pointer-events:auto}
#ramo-nav-shell-v190 .ramo-rail-btn{width:var(--rail-btn,38px);height:var(--rail-btn,38px);border:1px solid transparent;border-radius:10px;background:transparent;color:#86aebe;display:grid;place-items:center;cursor:pointer;transition:background .12s,border-color .12s,color .12s,box-shadow .12s}
#ramo-nav-shell-v190 .ramo-rail-btn svg{width:20px;height:20px}#ramo-nav-shell-v190 .ramo-rail-btn:hover{background:#0d2632;border-color:#284f61;color:#d9f6ff}
#ramo-nav-shell-v190 .ramo-rail-btn.active{background:#0b2430;border-color:#4b8299;color:#d8f4ff;box-shadow:inset 3px 0 #79d5ff}
#ramo-nav-shell-v190 .ramo-rail-mic{border-radius:50%;border-color:#274d5e;color:#a8cfdd}#ramo-nav-shell-v190 .ramo-rail-mic.listening{background:#0c2a37;border-color:#79d5ff;color:#e8fbff;box-shadow:0 0 0 3px rgba(121,213,255,.10),0 0 18px rgba(121,213,255,.20)}
#ramo-nav-shell-v190 .ramo-rail-spacer{height:6px;width:26px;border-top:1px solid #17313f}#ramo-nav-shell-v190 .ramo-rail-flex{flex:1}
#ramo-nav-shell-v190 .ramo-drawer{position:absolute;left:var(--rail-w,56px);top:0;bottom:0;width:var(--drawer-w,250px);padding:16px 14px;background:linear-gradient(180deg,rgba(7,20,28,.997),rgba(5,15,22,.997));border-right:1px solid #234657;box-shadow:18px 0 50px rgba(0,0,0,.28);transform:translateX(calc(-100% - 2px));opacity:0;pointer-events:none;transition:transform .16s ease,opacity .12s ease;overflow:auto}
#ramo-nav-shell-v190 .ramo-drawer.is-open{transform:translateX(0);opacity:1;pointer-events:auto}#ramo-nav-shell-v190 .ramo-drawer-head{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #17313f;padding:3px 2px 14px;margin-bottom:13px}
#ramo-nav-shell-v190 .ramo-drawer-head b{font-size:17px;letter-spacing:2px;color:#f4fbff}#ramo-nav-shell-v190 .ramo-drawer-head span{display:block;margin-top:4px;font-size:8px;letter-spacing:1.4px;color:#648a9b}
#ramo-nav-shell-v190 .ramo-close{width:30px;height:30px;border:1px solid #284f61;border-radius:8px;background:#0a1b25;color:#a7c8d6;font-size:19px;cursor:pointer}
#ramo-nav-shell-v190 .ramo-assistant-btn,#ramo-nav-shell-v190 .ramo-drawer-btn{width:100%;border:1px solid transparent;border-radius:9px;background:transparent;color:#9fc0cf;display:grid;grid-template-columns:34px 1fr;align-items:center;text-align:left;padding:9px;margin:2px 0;cursor:pointer;transition:background .12s,border-color .12s}
#ramo-nav-shell-v190 .ramo-assistant-btn{border-color:#2d5b70;background:#0a202b;margin-bottom:14px}#ramo-nav-shell-v190 .ramo-assistant-btn:hover,#ramo-nav-shell-v190 .ramo-drawer-btn:hover{background:#0d2632;border-color:#294e60}
#ramo-nav-shell-v190 .ramo-assistant-btn.active,#ramo-nav-shell-v190 .ramo-drawer-btn.active{background:#0b2531;border-color:#4b8299;color:#e2f7ff}
#ramo-nav-shell-v190 .ramo-assistant-btn svg,#ramo-nav-shell-v190 .ramo-drawer-btn svg{width:22px;height:22px;color:#8bc9df}#ramo-nav-shell-v190 .ramo-assistant-btn b,#ramo-nav-shell-v190 .ramo-drawer-btn b{display:block;font-size:12px;font-weight:600}
#ramo-nav-shell-v190 .ramo-assistant-btn small,#ramo-nav-shell-v190 .ramo-drawer-btn small{display:block;font-size:9px;color:#648a9b;margin-top:2px}
#ramo-nav-shell-v190 .ramo-drawer-mic{border-color:#244a5b;background:#081c26}#ramo-nav-shell-v190 .ramo-drawer-mic.listening{border-color:#79d5ff;background:#0c2a37}
#ramo-nav-shell-v190 .ramo-section-label{font-size:8px;letter-spacing:1.4px;color:#486c7d;padding:10px 9px 5px}
#ramo-nav-shell-v190 .ramo-drawer-context{margin-top:18px;border-top:1px solid #17313f;padding:14px 9px 4px}#ramo-nav-shell-v190 .ramo-drawer-context span{font-size:8px;letter-spacing:1.3px;color:#486c7d}#ramo-nav-shell-v190 .ramo-drawer-context b{display:block;font-size:12px;margin-top:6px;color:#bedde9}#ramo-nav-shell-v190 .ramo-drawer-context small{display:block;font-size:9px;color:#5f8392;margin-top:3px}`;
  s.textContent+='@media(max-height:430px){#ramo-nav-shell-v190 .ramo-rail-btn[data-page=research],#ramo-nav-shell-v190 .ramo-rail-btn[data-page=memory],#ramo-nav-shell-v190 .ramo-rail-btn[data-page=files]{display:none!important}#ramo-nav-shell-v190 .ramo-rail{gap:5px;padding:5px 0}}';document.head.appendChild(s);
 }
 _styleNavigation(g){if(!this.navShell||!g)return;const m=this._domScale();this.navShell.style.setProperty('--rail-w',(g.rail*m.sx)+'px');this.navShell.style.setProperty('--rail-btn',(g.railButton*Math.min(m.sx,m.sy))+'px');this.navShell.style.setProperty('--drawer-w',(g.drawerWidth*m.sx)+'px');}
 _syncNavState(){if(!this.navShell)return;const desktop=window.ramoDesktop?.pages?.current?.()||'';for(const b of this.navShell.querySelectorAll('[data-page]'))b.classList.toggle('active',b.dataset.page===(desktop||this.currentPage));const c=this.navShell.querySelector('.ramo-current-page');if(c)c.textContent=(PAGE_META[this.currentPage]||PAGE_META.home).title;}
 _ensureDesignStyle(){
   if(typeof document==='undefined')return;
   document.documentElement.dataset.ramoTheme=this.theme;
   let node=document.getElementById('ramo-design-system-v250');
   if(!node){node=document.createElement('style');node.id='ramo-design-system-v250';node.textContent=OC_DESIGN_CSS+'\n'+OC_V26_CSS+'\n'+OC_V27_CSS+'\n'+OC_V281_CSS+'\n'+OC_V214_CSS+'\n'+OC_V215_CSS+'\n'+OC_V215_VOICE_CSS;document.head.appendChild(node);}
   if(this.navShell){const label=this.navShell.querySelector('.ramo-theme-name');if(label)label.textContent=this.theme==='paper'?'Light appearance':'Graphite appearance';}
 }
 _toggleTheme(){
   this.theme=this.theme==='paper'?'graphite':'paper';
   try{localStorage.setItem('ramo-theme-v1',this.theme);}catch(_){}
   if(this.artBackdrop)this.artBackdrop.dataset.stamp='';
   this._ensureDesignStyle();this.apply(true);
 }
 _setupComposer(){if(typeof document==='undefined')return false;const pi=this._hideProjectPrompt();if(!pi)return false;const host=this._ensureOverlayRoot();if(!host)return false;let wrap=document.getElementById('ramo-composer-v180');if(!wrap){wrap=document.createElement('div');wrap.id='ramo-composer-v180';wrap.setAttribute('role','group');wrap.setAttribute('aria-label','Ramo command composer');const mic=document.createElement('button');mic.type='button';mic.id='ramo-composer-mic';mic.setAttribute('aria-label','Start speech to text');mic.onclick=()=>this._toggleLocalDictation();const input=document.createElement('textarea');input.id='ramo-command-input-v180';input.rows=1;input.autocomplete='off';input.spellcheck=true;input.placeholder='Ask Ramo…';input.setAttribute('aria-label','Ask Ramo');input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();this._sendComposer();}});input.addEventListener('input',()=>{this.suppressMirrorUntil=Date.now()+650;this._writeProjectPrompt(input.value);this._resizeComposer();this._syncComposerState(true);});const send=document.createElement('button');send.type='button';send.id='ramo-composer-send';send.setAttribute('aria-label','Send');send.onclick=()=>this._sendComposer();const think=document.createElement('button');think.type='button';think.className='oc-thinking-quick';think.title='Toggle reasoning for ordinary chat';think.setAttribute('aria-label','Toggle thinking');think.onclick=async()=>{const api=this._chatAPI();if(!api)return;if(api.session){this._syncThinkingButton();this._showSmallStatus('Model busy — change thinking after this response.');return;}try{await api.setLiveThinking(!api.liveThinking);}catch(e){this._showSmallStatus(String(e.message||e));}this._syncThinkingButton();};
    const more=document.createElement('button');more.type='button';more.className='oc-more-quick';more.textContent='⋯';more.title='Research model and voice settings';more.setAttribute('aria-label','More session settings');more.setAttribute('aria-expanded','false');more.onclick=()=>this._toggleSessionMenu();
    wrap.append(mic,input,think,more,send);const stt=document.createElement('div');stt.className='oc-stt-status';stt.hidden=true;stt.setAttribute('role','status');stt.setAttribute('aria-live','polite');stt.innerHTML='<span class="oc-stt-dot" aria-hidden="true"></span><span class="oc-stt-message"></span><button type="button" class="oc-stt-stop">Stop</button>';stt.querySelector('.oc-stt-stop').onclick=()=>this._stopLocalDictation();wrap.append(stt);host.appendChild(wrap);}this.composer=wrap;this._syncThinkingButton();
  if(!this._sessionDismissBound){this._sessionDismissBound=true;this._onSessionKey=e=>{if(e.key==='Escape'&&(this.composer?.querySelector('.oc-session-menu')||this.workspacePane?.querySelector('.oc-voice-panel'))){e.preventDefault();e.stopImmediatePropagation();this._toggleSessionMenu(false);this.workspacePane?.querySelector('.oc-voice-panel')?.remove();document.querySelector('.oc-tools-quick')?.focus();}};
    this._onSessionOutside=e=>{if(this.composer&&!this.composer.contains(e.target))this._toggleSessionMenu(false);};
    document.addEventListener('keydown',this._onSessionKey);document.addEventListener('pointerdown',this._onSessionOutside);}
  for(const id of ['ui-mic','ui-send']){const old=this._findPI(id);if(old)old.style.setProperty('display','none','important');}return true;}
 _showSmallStatus(message){
  let tip=this.composer?.querySelector('.oc-quick-status');if(!tip&&this.composer){tip=document.createElement('div');tip.className='oc-quick-status';tip.setAttribute('role','status');this.composer.append(tip);}if(!tip)return;
  tip.textContent=message;tip.hidden=false;clearTimeout(this._quickStatusTimer);this._quickStatusTimer=setTimeout(()=>{if(tip)tip.hidden=true;},3500);
 }
 _toggleSessionMenu(force){
  if(!this.composer)return;
  const open=typeof force==='boolean'?force:!this.composer.querySelector('.oc-session-menu');
  this.composer.querySelector('.oc-session-menu')?.remove();const btn=this.composer.querySelector('.oc-more-quick');if(btn)btn.setAttribute('aria-expanded',String(open));if(!open)return;
  const menu=document.createElement('div');menu.className='oc-session-menu';menu.setAttribute('role','group');menu.setAttribute('aria-label','Session settings');
  menu.innerHTML='<div class="oc-session-title">Session settings</div><label class="oc-session-field"><span>Research model</span><select class="oc-research-model" aria-label="Research model"></select></label><button type="button" class="oc-model-refresh">Refresh installed Ollama models</button><div class="oc-model-refresh-note" role="status"></div><button type="button" class="oc-voice-settings">Pocket TTS settings</button><div class="oc-session-help"></div>';
  this.composer.append(menu);this._wireModelPickers(menu);this._syncVoiceStatus();
  const note=menu.querySelector('.oc-model-refresh-note');
  const updateNote=()=>{note.textContent=this.ollamaInventoryOnline
    ?`${this.ollamaInventory.length} Ollama model${this.ollamaInventory.length===1?'':'s'} installed`
    :(this.ollamaInventoryError||'Ollama model list not available');};
  updateNote();
  menu.querySelector('.oc-model-refresh').onclick=async()=>{
    const btn=menu.querySelector('.oc-model-refresh');btn.disabled=true;note.textContent='Checking Ollama…';
    try{await this._refreshOllamaInventory(true);updateNote();}finally{btn.disabled=false;}
  };
  menu.querySelector('.oc-voice-settings').onclick=()=>{this._toggleSessionMenu(false);this._showVoiceSettings();};
 }
 _sttNotice(phase,message,canStop=false){
  const area=this.composer?.querySelector('.oc-stt-status'),mic=this.composer?.querySelector('#ramo-composer-mic');
  if(!area)return;
  if(this._sttNoticeTimeout){clearTimeout(this._sttNoticeTimeout);this._sttNoticeTimeout=null;}
  area.hidden=false;area.dataset.phase=phase;area.querySelector('.oc-stt-message').textContent=message;
  area.querySelector('.oc-stt-stop').hidden=!canStop;
  if(mic){mic.dataset.sttListening=phase==='listening'?'1':'0';mic.setAttribute('aria-pressed',String(!!this._sttActive));mic.setAttribute('aria-label',this._sttActive?'Stop speech recognition':'Start speech recognition');}
  if(this.composer)this.composer.dataset.sttActive=this._sttActive?'1':'0';
  if(!canStop&&phase!=='error')this._sttNoticeTimeout=setTimeout(()=>{if(!this._sttActive)area.hidden=true;},5000);
 }
 _insertDictationDraft(text,base){
  const input=this.composer?.querySelector('#ramo-command-input-v180');if(!input)return;
  const fragment=String(text||'').trim();
  if(!fragment)return;
  // Preserve text the user had typed; never submit from speech events.
  const draft=String(base||'').trimEnd();
  const result=draft+(draft?' ':'')+fragment;
  input.value=result;this.suppressMirrorUntil=Date.now()+2000;
  this._writeProjectPrompt(result);
 }
 async _stopLocalDictation(){
  if(!this._sttActive)return;
  this._sttNotice('processing','Finishing transcription…',false);
  try{await window.ramoDesktop?.stt?.stop?.();}catch(e){this._sttNotice('error',String(e?.message||e),false)}
 }
 async _toggleLocalDictation(){
  if(this._sttActive){await this._stopLocalDictation();return;}
  const api=window.ramoDesktop?.stt;
  if(!api?.recognize){this._sttNotice('error','Local speech recognition is unavailable.',false);return;}
  const input=this.composer?.querySelector('#ramo-command-input-v180');
  if(!input)return;
  const base=input.value||'';this._sttActive=true;
  this._sttNotice('setup','Preparing offline microphone…',true);
  const unsubscribe=typeof api.onEvent==='function'?api.onEvent(evt=>{
    if(!this._sttActive)return;
    if(evt.type==='ready'){this._sttNotice('listening','Listening… click Stop or the mic to finish. Text will not send automatically.',true);}
    else if(evt.type==='status'){this._sttNotice('setup',String(evt.message||'Loading local speech model…'),true);}
    else if(evt.type==='partial'){this._insertDictationDraft(evt.text,base);this._sttNotice('listening','Listening… transcript is being added to the text box. Nothing is sent.',true);}
    else if(evt.type==='final'){this._insertDictationDraft(evt.text,base);this._sttNotice('processing','Transcription complete — review before sending.',false);}
    else if(evt.type==='error'){this._sttNotice('error',String(evt.message||'Speech recognition failed'),false);}
  }):()=>{};
  try{
    const text=await api.recognize();
    if(text)this._insertDictationDraft(text,base);
    this._sttNotice('complete',text?'Dictation added to the text box. Review and press Send when ready.':'No speech recognized. Nothing was sent.',false);
    input.focus({preventScroll:true});
  }catch(e){this._sttNotice('error',String(e?.message||'Could not transcribe speech.'),false);}
  finally{unsubscribe();this._sttActive=false;this.composer.dataset.sttActive='0';
    const mic=this.composer.querySelector('#ramo-composer-mic');if(mic){mic.dataset.sttListening='0';mic.setAttribute('aria-pressed','false');mic.setAttribute('aria-label','Start speech recognition');}}
 }
 _styleComposer(g){
  if(!this.composer||!g)return;
  const m=this._domScale(),height=g.composerH*m.sy,wrap=this.composer;
  // The composer is the chat input. A page of the workspace — Memory,
  // Research, Files — is not a chat, so the input is taken away there
  // instead of floating over the page with nothing to answer.
  Object.assign(wrap.style,{position:'absolute',left:(g.composerLeft*m.sx)+'px',bottom:(g.composerBottom*m.sy)+'px',width:(g.composerWidth*m.sx)+'px',height:height+'px',boxSizing:'border-box',display:this.currentPage==='home'?'flex':'none',alignItems:'center',gap:'7px',padding:'6px 9px',border:'1px solid var(--oc-rule)',borderRadius:'14px',background:'var(--oc-paper)',boxShadow:'0 6px 22px rgba(0,0,0,.16)',zIndex:'2147483000',pointerEvents:'auto'});
  const input=wrap.querySelector('#ramo-command-input-v180');
  if(input)Object.assign(input.style,{height:(this.composerHeight>60?this.composerHeight-54:24)+'px',flex:'1 1 90px',minWidth:'45px',boxSizing:'border-box',border:'0',borderRadius:'8px',outline:'none',background:'transparent',color:'var(--oc-text)',padding:'0 8px',fontSize:'14px',fontFamily:'Segoe UI,system-ui,sans-serif',caretColor:'var(--oc-accent)',boxShadow:'none'});
  const mic=wrap.querySelector('#ramo-composer-mic'),send=wrap.querySelector('#ramo-composer-send');
  for(const b of [mic,send])if(b)Object.assign(b.style,{height:'36px',width:'36px',minWidth:'36px',padding:'0',border:'0',borderRadius:'9px',background:'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'});
  if(send)send.innerHTML='<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12L20 4l-5 16-3.1-7.9L4 12z"/><path d="m12 12 8-8"/></svg>';
 }
 _renderMarkdown(text){
  const lines=String(text||'').replace(/\r/g,'').split('\n');let out='',inList=false,ol=false;
  const inline=value=>{
   const held=[],hold=html=>'\u0000'+(held.push(html)-1)+'\u0000';
   let s=String(value).replace(/`([^`]+)`/g,(_,code)=>hold('<code>'+esc(code)+'</code>'));
   s=s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)/g,(whole,label,raw)=>{
    try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol))return whole;const href=esc(url.href).replace(/"/g,'&quot;');return hold('<a href="'+href+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>');}catch{return whole;}
   });
   return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'<em>$1</em>').replace(/\u0000(\d+)\u0000/g,(_,i)=>held[Number(i)]||'');
  };
  const close=()=>{if(inList){out+=ol?'</ol>':'</ul>';inList=false;}};
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
  for(let i=0;i<lines.length;i++){
   const line=lines[i].trimEnd(),fence=line.match(/^\s*(`{3,}|~{3,})([\w-]*)\s*$/);
   if(fence){close();const code=[],mark=fence[1][0];for(i++;i<lines.length;i++){if(lines[i].trim().startsWith(mark.repeat(fence[1].length)))break;code.push(lines[i]);}out+='<pre><code>'+esc(code.join('\n'))+'</code></pre>';continue;}
   if(line.includes('|')&&i+1<lines.length&&cells(lines[i+1]).length>=2&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
    close();const headers=cells(line);out+='<div class="oc-markdown-table"><table><thead><tr>'+headers.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>';i++;
    while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){const row=cells(lines[++i]);out+='<tr>'+headers.map((_,j)=>'<td>'+inline(row[j]||'')+'</td>').join('')+'</tr>';}
    out+='</tbody></table></div>';continue;
   }
   const hm=line.match(/^(#{1,4})\s+(.+)$/);if(hm){close();const n=hm[1].length;out+='<h'+n+'>'+inline(hm[2])+'</h'+n+'>';continue;}
   if(/^\s*([-*_])\1{2,}\s*$/.test(line)){close();out+='<hr>';continue;}
   const bm=line.match(/^[-*]\s+(.+)$/),nm=line.match(/^\d+[.)]\s+(.+)$/);
   if(bm||nm){const nowOl=!!nm;if(!inList||ol!==nowOl){close();ol=nowOl;inList=true;const start=nowOl?Number.parseInt(line,10):1;out+=ol?(Number.isSafeInteger(start)&&start!==1?'<ol start="'+start+'">':'<ol>'):'<ul>';}out+='<li>'+inline((bm||nm)[1])+'</li>';continue;}
   close();if(!line.trim()){out+='<div class="ramo-space"></div>';continue;}
   const quote=line.match(/^>\s?(.*)$/);out+=quote?'<blockquote>'+inline(quote[1])+'</blockquote>':'<p>'+inline(line)+'</p>';
  }
  close();return out;
 }
 _responseText(){let s=String(this._getVar('tamai_shell_text_out_v1','')||'').trim();if(!s)s=String(this._getNamed('Assistant Answer','')||'').trim();if(!s)s=String(this._getNamed('Final Response','')||'').trim();return s;}
 _setupWorkspace(){
  if(typeof document==='undefined')return false;const host=this._ensureOverlayRoot();if(!host)return false;let pane=document.getElementById('ramo-workspace-pane-v180');
  if(!pane){
    pane=document.createElement('section');pane.id='ramo-workspace-pane-v180';pane.setAttribute('aria-label','Ramo page');
    pane.innerHTML='<div class="ramo-w-head"><div class="ramo-w-title"><span class="ramo-w-name">Conversation</span><label class="oc-model-picker oc-header-model" title="Chat model"><span class="oc-model-label">Model</span><select class="oc-chat-model" aria-label="Chat model"></select></label></div><div class="ramo-w-subtitle"></div></div><div id="ramo-workspace-content-v180" class="ramo-w-content"></div>';
    host.appendChild(pane);this.workspacePane=pane;this.workspaceContent=pane.querySelector('#ramo-workspace-content-v180');
    this._wireModelPickers(pane);this._ensureWorkspaceStyle();
  }else{this.workspacePane=pane;this.workspaceContent=pane.querySelector('#ramo-workspace-content-v180');}

  return true;
 }
 _ensureWorkspaceStyle(){
  if(typeof document==='undefined'||document.getElementById('ramo-workspace-style-v180'))return;const style=document.createElement('style');style.id='ramo-workspace-style-v180';
  style.textContent=`#ramo-workspace-pane-v180 .oc-inline-activity{margin:0 0 14px;max-width:72ch;border-left:2px solid var(--oc-rule,rgba(235,235,235,.16));padding-left:12px}
#ramo-workspace-pane-v180 .oc-inline-title{display:flex;align-items:center;gap:7px;min-height:27px;padding:4px 5px;background:transparent;border:0;color:var(--oc-soft,#deded4);font:550 13px/1.5 "Segoe UI",system-ui,sans-serif;cursor:pointer;text-align:left;width:100%}
#ramo-workspace-pane-v180 .oc-inline-title:hover{color:var(--oc-text,#fff)}
#ramo-workspace-pane-v180 .oc-inline-caret{font-size:12px;color:var(--oc-muted,#aaa);transition:transform .15s}
#ramo-workspace-pane-v180 .oc-inline-activity[data-open="1"] .oc-inline-caret{transform:rotate(180deg)}
#ramo-workspace-pane-v180 .oc-inline-status{font-size:11px;color:var(--oc-muted,#aaa);margin-left:7px}
#ramo-workspace-pane-v180 .oc-inline-body{margin-top:5px;padding:3px 2px 7px 9px;color:var(--oc-soft,#ccc);font-size:12px}
#ramo-workspace-pane-v180 .oc-inline-step{padding:7px 0;border-bottom:1px solid var(--oc-rule,rgba(255,255,255,.08));overflow-wrap:anywhere}
#ramo-workspace-pane-v180 .oc-inline-step:last-child{border:0}
#ramo-workspace-pane-v180 .oc-inline-metrics-grid{display:grid;grid-template-columns:minmax(135px,1fr) auto;gap:5px 14px;margin-top:10px;font-size:12px;color:var(--oc-muted,#aaa);max-width:370px}
#ramo-workspace-pane-v180 .oc-inline-metrics-grid strong{color:var(--oc-text,#eee);font-weight:550;text-align:right;font-variant-numeric:tabular-nums}
#ramo-workspace-pane-v180 .oc-inline-metrics .oc-inline-mute{font-size:11px;line-height:1.4;margin-top:10px;opacity:.7}
#ramo-workspace-pane-v180 .oc-inline-kind{font-weight:620;color:var(--oc-text,#eee);font-size:12px}
#ramo-workspace-pane-v180 .oc-inline-muted{color:var(--oc-muted,#aaa);font-size:11px;line-height:1.5;margin:3px 0}
#ramo-workspace-pane-v180 .oc-inline-details{margin-top:4px}
#ramo-workspace-pane-v180 .oc-inline-details summary{color:var(--oc-accent,#a9bf99);cursor:pointer;font-size:11px;list-style:none}
#ramo-workspace-pane-v180 .oc-inline-details summary::after{content:'  ⌄'}
#ramo-workspace-pane-v180 .oc-inline-details[open] summary::after{content:'  ⌃'}
#ramo-workspace-pane-v180 .oc-inline-pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 "Segoe UI",system-ui,sans-serif;max-height:220px;overflow:auto;border-radius:9px;padding:10px;background:var(--oc-surface,#333);color:var(--oc-soft,#ddd);user-select:text}
#ramo-workspace-pane-v180 .oc-inline-link{color:var(--oc-accent,#bdd09c);text-decoration:underline;text-underline-offset:2px}
#ramo-workspace-pane-v180 .oc-inline-result-status{font-size:11px;color:var(--oc-muted,#aaa);margin:5px 0 6px}
#ramo-workspace-pane-v180 .oc-inline-sources{display:flex;flex-direction:column;gap:7px;margin:7px 0 9px}
#ramo-workspace-pane-v180 .oc-inline-source{background:var(--oc-surface,#30332d);border:1px solid var(--oc-rule,rgba(255,255,255,.1));border-radius:10px;padding:8px 11px;min-width:0;overflow-wrap:anywhere}
#ramo-workspace-pane-v180 .oc-inline-source-link{font-size:12px;line-height:1.5;color:var(--oc-accent,#bde0ca);text-decoration:none;font-weight:590;display:inline-block}
#ramo-workspace-pane-v180 .oc-inline-source-link:hover{text-decoration:underline}
#ramo-workspace-pane-v180 .oc-inline-source-meta{font-size:10.5px;color:var(--oc-muted,#aaa);margin-top:2px}
#ramo-workspace-pane-v180 .oc-inline-jump{position:absolute;z-index:5;bottom:16px;left:50%;transform:translateX(-50%);background:var(--oc-paper,#252a26);color:var(--oc-text,#eee);border:1px solid var(--oc-rule,#666);border-radius:20px;padding:7px 13px;font:12px system-ui;cursor:pointer;box-shadow:0 3px 18px #0005}
#ramo-workspace-pane-v180 .oc-inline-stream{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--oc-surface,#30332d);border-radius:8px;padding:10px;margin-top:8px;font-size:12px}
#ramo-workspace-pane-v180 *{box-sizing:border-box}#ramo-workspace-pane-v180 .ramo-w-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 15px 10px;border-bottom:1px solid rgba(34,70,86,.72);background:rgba(8,23,32,.50);min-height:58px}
#ramo-workspace-pane-v180 .ramo-w-title{display:flex;align-items:center;gap:12px;min-width:0}#ramo-workspace-pane-v180 .ramo-w-kicker{font:600 8px/1.2 Arial,sans-serif;letter-spacing:1.7px;color:#557f91}
#ramo-workspace-pane-v180 .ramo-w-name{font:600 14px/1.2 Arial,sans-serif;letter-spacing:.45px;color:#dff4fc;margin-top:3px}#ramo-workspace-pane-v180 .ramo-w-subtitle{font:400 10px/1.35 Arial,sans-serif;color:#6f96a7;max-width:520px}
#ramo-workspace-pane-v180 .ramo-w-actions{display:flex;align-items:center;gap:7px;flex:0 0 auto}#ramo-workspace-pane-v180 .ramo-w-actions button{border:1px solid #294f61;border-radius:7px;background:#091a23;color:#a9d2e2;font:600 9px Arial,sans-serif;padding:6px 9px;cursor:pointer}
#ramo-workspace-pane-v180 .ramo-w-actions button:hover{background:#102d3c}
#ramo-workspace-pane-v180 .oc-model-picker{display:flex;align-items:center;gap:4px;color:#b7d6e4;font:600 10px Arial,sans-serif;white-space:nowrap}
#ramo-workspace-pane-v180 .oc-model-picker select{max-width:92px;background:#0b2230;color:#e4f4fa;border:1px solid #315a6c;border-radius:7px;padding:5px 3px;font-size:10px;cursor:pointer}
#ramo-workspace-pane-v180 .oc-voice-panel{position:absolute;z-index:250;top:54px;right:12px;display:grid;gap:9px;width:min(350px,calc(100% - 20px));max-height:80%;overflow:auto;padding:16px;background:#0b1c29;color:#d5eaf2;border:1px solid #416578;border-radius:12px;box-shadow:0 15px 40px #000c;font:12px Arial,sans-serif}
#ramo-workspace-pane-v180 .oc-voice-panel p{margin:0;line-height:1.45;color:#9cc0cf}
#ramo-workspace-pane-v180 .oc-voice-panel label{display:flex;justify-content:space-between;align-items:center;gap:10px}
#ramo-workspace-pane-v180 .oc-voice-panel select{padding:7px;border:1px solid #395b6d;background:#0a1922;color:#eaf7ff;border-radius:7px}
#ramo-workspace-pane-v180 .oc-voice-row{display:flex;gap:7px;flex-wrap:wrap}
#ramo-workspace-pane-v180 .oc-voice-row button{border:1px solid #477082;border-radius:7px;background:#153346;color:#eaf7ff;padding:8px;cursor:pointer}
#ramo-workspace-pane-v180 .oc-voice-message{color:#ffb6a0!important}
@media(max-width:1050px){#ramo-workspace-pane-v180 .oc-model-picker{font-size:0}#ramo-workspace-pane-v180 .oc-model-picker select{max-width:72px}}#ramo-workspace-pane-v180 .ramo-w-chat{padding:9px 11px;margin:0 0 13px;border:1px solid rgba(90,125,129,.24);border-radius:10px}#ramo-workspace-pane-v180 .ramo-w-chat.user{margin-left:9%;background:rgba(81,95,78,.18)}#ramo-workspace-pane-v180 .ramo-w-chat.assistant{margin-right:5%;background:rgba(25,36,34,.78)}#ramo-workspace-pane-v180 .oc-speaker{font:700 10px Arial,sans-serif;letter-spacing:1px;opacity:.62;margin:0 0 7px}#ramo-workspace-pane-v180 .oc-chat-menu{position:absolute;top:54px;right:11px;width:min(320px,calc(100% - 22px));max-height:min(450px,75%);overflow:auto;background:var(--oc-paper,#242b29);border:1px solid #63716a;border-radius:10px;box-shadow:0 15px 42px #000a;z-index:200;padding:9px}#ramo-workspace-pane-v180 .oc-chat-option{display:flex;align-items:center;gap:5px;margin-bottom:4px}#ramo-workspace-pane-v180 .oc-chat-option button{background:transparent;border:0;padding:9px;color:inherit;cursor:pointer;border-radius:6px}#ramo-workspace-pane-v180 .oc-chat-option .oc-chat-title{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#ramo-workspace-pane-v180 .oc-chat-option.active{background:rgba(119,151,128,.16)}@media(max-width:760px){#ramo-workspace-pane-v180 .ramo-w-model,#ramo-workspace-pane-v180 .ramo-w-copy{display:none!important}#ramo-workspace-pane-v180 .ramo-w-actions{gap:3px!important}#ramo-workspace-pane-v180 .ramo-w-actions button{padding:6px!important}}#ramo-workspace-pane-v180 .ramo-w-model{font:500 8px/1.2 Arial,sans-serif;letter-spacing:1px;color:#668b9b;margin-left:3px}
#ramo-workspace-pane-v180 .ramo-w-content{position:relative;flex:1;min-height:0;overflow:hidden}#ramo-workspace-pane-v180 .ramo-chat-scroll{position:absolute;inset:0;overflow:auto;padding:17px 19px 24px;scrollbar-width:thin;scrollbar-color:#315c70 transparent}
#ramo-workspace-pane-v180 .ramo-reading{max-width:82ch;color:#c9e0e9;font:400 14px/1.58 Arial,sans-serif;text-align:left}#ramo-workspace-pane-v180 .ramo-reading p{margin:0 0 11px}
#ramo-workspace-pane-v180 .ramo-reading h1,#ramo-workspace-pane-v180 .ramo-reading h2,#ramo-workspace-pane-v180 .ramo-reading h3,#ramo-workspace-pane-v180 .ramo-reading h4{color:#eefaff;margin:19px 0 8px;line-height:1.24}
#ramo-workspace-pane-v180 .ramo-reading h1{font-size:21px}#ramo-workspace-pane-v180 .ramo-reading h2{font-size:18px}#ramo-workspace-pane-v180 .ramo-reading h3{font-size:16px}#ramo-workspace-pane-v180 .ramo-reading h4{font-size:14px}
#ramo-workspace-pane-v180 .ramo-reading ul,#ramo-workspace-pane-v180 .ramo-reading ol{margin:5px 0 14px;padding-left:22px}#ramo-workspace-pane-v180 .ramo-reading li{margin:4px 0}
#ramo-workspace-pane-v180 .ramo-reading code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.91em;color:#bfefff;background:#0b202b;padding:2px 5px;border-radius:4px}
#ramo-workspace-pane-v180 .ramo-reading strong{color:#effbff}#ramo-workspace-pane-v180 .ramo-space{height:6px}#ramo-workspace-pane-v180 .ramo-empty{height:100%;display:flex;align-items:flex-start;justify-content:flex-start;flex-direction:column;color:#658493;padding-top:2px}
#ramo-workspace-pane-v180 .ramo-empty b{color:#b8d9e6;font-size:15px;margin-bottom:5px}#ramo-workspace-pane-v180 .ramo-empty span{font-size:12px;max-width:440px;line-height:1.5}
#ramo-workspace-pane-v180.page-mode{border-radius:8px!important;box-shadow:none!important;background:rgba(5,15,22,.992)!important}
#ramo-workspace-pane-v180.page-mode .ramo-w-head{min-height:66px;background:rgba(7,20,28,.94);padding-left:18px}#ramo-workspace-pane-v180.page-mode .ramo-w-name{font-size:17px}#ramo-workspace-pane-v180.page-mode .ramo-w-subtitle{display:block}
@media(max-width:700px){#ramo-workspace-pane-v180 .ramo-w-head{padding:8px 10px;min-height:48px}#ramo-workspace-pane-v180 .ramo-w-model{display:none}#ramo-workspace-pane-v180 .ramo-w-subtitle{display:none!important}#ramo-workspace-pane-v180 .ramo-chat-scroll{padding:12px 13px 16px}#ramo-workspace-pane-v180 .ramo-reading{font-size:12.5px}}`;
  style.textContent+="\n/* Ramo 2.8.19: post-generation inference info uses the same Graphite surface. */\n#ramo-workspace-pane-v180 .oc-response-stats{display:flex;flex-wrap:wrap;align-items:center;gap:5px 9px;max-width:100%;margin:12px 0 2px;padding:7px 0;border-top:1px solid var(--oc-rule);font:12px/1.5 'Segoe UI',system-ui,sans-serif;color:var(--oc-muted)}\n#ramo-workspace-pane-v180 .oc-response-stats-name{font-weight:650;color:var(--oc-soft)}\n#ramo-workspace-pane-v180 .oc-response-stats-values{font-variant-numeric:tabular-nums;color:var(--oc-text)}\n#ramo-workspace-pane-v180 .oc-response-stats .oc-inline-metrics{flex-basis:100%;min-width:0;margin:0}\n#ramo-workspace-pane-v180 .oc-response-stats .oc-inline-metrics summary{font:500 11px/1.5 'Segoe UI',system-ui,sans-serif;color:var(--oc-accent);width:max-content;padding:2px 0;cursor:pointer}\n#ramo-workspace-pane-v180 .oc-response-stats .oc-inline-metrics:not([open]){flex:0 0 auto}\n#ramo-workspace-pane-v180 .oc-response-stats .oc-inline-metrics[open]{flex-basis:100%;padding:5px 0 8px}\n#ramo-workspace-pane-v180 .oc-response-stats .oc-inline-metrics[open] summary{padding-bottom:6px}\n#ramo-workspace-pane-v180 .oc-response-stats .oc-inline-metrics-grid{max-width:440px;grid-template-columns:minmax(130px,1fr) auto}\n#ramo-workspace-pane-v180 .oc-session-help:empty{display:none}\n";
  document.head.appendChild(style);
 }
 _styleWorkspace(g){
  if(!this.workspacePane||!g)return;const m=this._domScale(),left=g.workspaceLeft*m.sx,top=g.workspaceTop*m.sy,width=g.workspaceWidth*m.sx,height=g.workspaceHeight*m.sy,p=this.workspacePane;
  p.classList.toggle('page-mode',this.currentPage!=='home');
  Object.assign(p.style,{position:'absolute',left:left+'px',top:top+'px',width:width+'px',height:height+'px',boxSizing:'border-box',display:'flex',flexDirection:'column',border:'1px solid var(--oc-rule)',borderRadius:(this.currentPage==='home'?clamp(Math.min(width,height)*.020,8,12):8)+'px',background:'var(--oc-bg)',boxShadow:this.currentPage==='home'?'0 12px 38px rgba(0,0,0,.18)':'none',overflow:'hidden',zIndex:'2147482500',pointerEvents:'auto'});
 }
 _setWorkspaceHeader(){
  if(!this.workspacePane)return;
  const m=PAGE_META[this.currentPage]||PAGE_META.home;
  const name=this.workspacePane.querySelector('.ramo-w-name');
  if(name)name.textContent=this.currentPage==='home'?((this.chatView.chats||[]).find(c=>c.id===this.chatView.active)?.title||'Main'):m.title;
  const subtitle=this.workspacePane.querySelector('.ramo-w-subtitle');if(subtitle)subtitle.textContent=this.currentPage==='home'?'':m.subtitle;
  const model=this.workspacePane.querySelector('.oc-header-model');if(model)model.hidden=this.currentPage!=='home';
  this.workspacePane.classList.toggle('page-mode',this.currentPage!=='home');this._syncModelPickers();this._syncNavState();
 }
 _validOllamaModelName(value){
   return typeof value==='string'&&value.length>0&&value.length<=180&&!/[\s\x00-\x1f\x7f]/.test(value);
 }
 async _refreshOllamaInventory(force=false){
   const api=globalThis.ramoDesktop?.ollamaModels;
   if(typeof api!=='function')return;
   const now=Date.now();
   if(this.ollamaInventoryPromise)return this.ollamaInventoryPromise;
   if(!force&&now-this.ollamaInventoryLast<15000)return;
   this.ollamaInventoryLast=now;
   this.ollamaInventoryPromise=(async()=>{
     try{
       const result=await api();
       if(result?.online&&Array.isArray(result.models)){
         const seen=new Set();
         this.ollamaInventory=result.models.filter(m=>{
           const name=m?.name;
           if(!this._validOllamaModelName(name)||!globalThis.RamoHarnessCore?.allowedModel(name)||seen.has(name))return false;
           seen.add(name);return true;
         }).slice(0,512);
         this.ollamaInventoryOnline=true;this.ollamaInventoryError='';
       }else{
         // Do not erase the last good inventory when Ollama temporarily goes down.
         this.ollamaInventoryOnline=false;
         this.ollamaInventoryError=String(result?.error||'Ollama is not responding.').slice(0,200);
       }
     }catch(_){
       this.ollamaInventoryOnline=false;this.ollamaInventoryError='Could not reach local Ollama.';
     }
     this._syncModelPickers();
   })().finally(()=>{this.ollamaInventoryPromise=null;});
   return this.ollamaInventoryPromise;
 }
 _preferredModelRank(name){
   const s=String(name||'').toLowerCase();
   if(/^qwen3[.\-]?5[:\-]4b(?:$|[^0-9])/.test(s))return 0;
   if(/^qwen3[.\-]?5[:\-]9b(?:$|[^0-9])/.test(s))return 1;
   const bonsai=/bonsai[._\- ]?2|bonsai2/.test(s);
   if(bonsai&&/(?:^|[:_\-])2b(?:$|[^0-9])/.test(s))return 2;
   if(bonsai&&/(?:^|[:_\-])4b(?:$|[^0-9])/.test(s))return 3;
   if(bonsai&&/(?:^|[:_\-])9b(?:$|[^0-9])/.test(s))return 4;
   if(bonsai&&/(?:^|[:_\-])27b(?:$|[^0-9])/.test(s))return 5;
   if(bonsai)return 6;
   if(/qwen3[.\-]?6/.test(s)&&/(?:35b|a3b|moe)/.test(s))return 7;
   return 99;
 }
 _chatModelProfiles(){
   const registry=globalThis.__ramoModelRegistry||[];
   return [['fast','Fast',false],['smart','Smart',false],['superSmart','Super Smart',true]].map(([tier,label,thinking])=>{
     const configured=registry.find(p=>p.tier===tier)||registry.find(p=>p.label===label);
     return configured?.model?{name:configured.model,label,details:configured.model,thinking}:null;
   }).filter(Boolean);
 }
 _applyInitialProfileThinking(){
   if(this._chatProfileDefaultInitialized)return;
   const api=this._chatAPI();if(!api)return;
   const current=String(this._getNamed('Assistant Model',this._chatModelProfiles().find(p=>p.label==='Fast')?.name||'')||'').trim();
   const profile=this._chatModelProfiles().find(p=>p.name===current);
   // Don't reset a custom model's previously chosen thinking state.
   this._chatProfileDefaultInitialized=true;
   if(profile){Promise.resolve(api.setLiveThinking(profile.thinking)).then(()=>this._syncThinkingButton()).catch(e=>this._showSmallStatus('Thinking default not applied: '+e.message));}
 }
 _availableModelChoices(current,chatPicker=false){
   // The three local tiers plus every API profile saved under Settings → API
   // keys. `name` is both the value the toolbar select stores and the id the
   // runtime resolves, so the composer menu and the select cannot disagree.
   const choices=this._chatModelProfiles().map(p=>({...p,group:'profiles'}));
   const seen=new Set(choices.map(c=>c.name));
   for(const p of globalThis.__ramoModelRegistry||[]){
     if(!p||p.kind!=='api'||typeof p.model!=='string'||!p.model||seen.has(p.model))continue;
     seen.add(p.model);
     choices.push({name:p.model,label:p.label||p.name||p.model,details:[p.provider,p.providerModel].filter(Boolean).join(' · ')||'Cloud provider model',group:'api',kind:'api'});
   }
   return choices;
 }
 _wireModelPickers(root){
   for(const name of ['Assistant Model','Research Report Model']){
     try{const saved=localStorage.getItem('ramo-model-choice-v288-'+name);
       if(this._chatModelProfiles().some(p=>p.name===saved)){const variable=this._findVarByName(name);if(variable)variable.value=saved;}
     }catch(_){}
   }
   this._applyInitialProfileThinking();
   for(const [cls,varName] of [['.oc-chat-model','Assistant Model'],['.oc-research-model','Research Report Model']]){
     const select=root.querySelector(cls);if(!select||select.dataset.ocBound==='1')continue;
     select.dataset.ocBound='1';
     select.addEventListener('focus',()=>{this._refreshOllamaInventory(false);});
     select.addEventListener('blur',()=>{this._syncModelPickers();});
     select.addEventListener('pointerdown',()=>{this._refreshOllamaInventory(false);});
     select.addEventListener('change',()=>{
       const value=select.value,chatPicker=varName==='Assistant Model';
       if(chatPicker&&(value==='__ramo_more_models__'||value==='__ramo_less_models__')){
         this._chatModelsExpanded=value==='__ramo_more_models__';
         this._syncModelPickers(true);return;
       }
       const choices=this._availableModelChoices(String(this._getNamed(varName,'')||''),chatPicker);
       if(!choices.some(c=>c.name===value)){this._syncModelPickers(true);return;}
       if(this._chatAPI()?.session){this._syncModelPickers(true);this._showSmallStatus('Model busy — switch after the current task.');return;}
       const current=this._findVarByName(varName);if(current)current.value=value;
       try{localStorage.setItem('ramo-model-choice-v288-'+varName,value);}catch(_){}
       if(chatPicker){
         const profile=this._chatModelProfiles().find(p=>p.name===value);
         if(profile){
           this._chatModelsExpanded=false;
           // Selecting a profile always reapplies its default. The existing
           // composer thinking button remains a temporary manual override.
           const api=this._chatAPI();
           if(api)Promise.resolve(api.setLiveThinking(profile.thinking)).then(()=>this._syncThinkingButton()).catch(e=>this._showSmallStatus('Thinking default not applied: '+e.message));
           this._showSmallStatus(profile.label+' · thinking '+(profile.thinking?'on':'off')+' by default. You can override it.');
         }
       }
       this._syncModelPickers(true);this._updateCoreState(true);
     });
   }
   this._syncModelPickers();this._refreshOllamaInventory(false);
 }
 _syncModelPickers(force=false){
   this._applyInitialProfileThinking();
   for(const [cls,varName,def] of [['.oc-chat-model','Assistant Model',this._chatModelProfiles().find(p=>p.label==='Fast')?.name||''],['.oc-research-model','Research Report Model',this._chatModelProfiles().find(p=>p.label==='Smart')?.name||this._chatModelProfiles()[0]?.name||'']]){
     const sel=this.workspacePane?.querySelector(cls)||this.composer?.querySelector(cls);if(!sel)continue;
     let current=String(this._getNamed(varName,def)||def).trim();const chatPicker=varName==='Assistant Model';if(!this._availableModelChoices().some(p=>p.name===current)){current=def;const variable=this._findVarByName(varName);if(variable)variable.value=def;try{localStorage.setItem('ramo-model-choice-v288-'+varName,def);}catch{}}
     const choices=this._availableModelChoices(current,chatPicker);
     const key=choices.map(c=>c.name+'\t'+c.label).join('|');
     if(sel.dataset.choices!==key){
       // Avoid rebuilding a focused native dropdown during ordinary inventory refresh.
       if(!force&&document.activeElement===sel)return;
       sel.replaceChildren();
       let group='',container=sel;
       for(const c of choices){
         if(c.group!==group){group=c.group;container=document.createElement('optgroup');container.label=({profiles:'Everyday · three profiles',api:'API models · your keys',preferred:'Recommended · installed',other:'Other installed Ollama models',external:'External llama.cpp',selected:'Previously selected',advanced_action:'More choices'})[group]||'Other';sel.appendChild(container);}
         const option=document.createElement('option');option.value=c.name;
         option.textContent=c.label;option.title=c.details||c.name;container.appendChild(option);
       }
       sel.dataset.choices=key;
     }
     if(sel.value!==current&&Array.from(sel.options).some(o=>o.value===current))sel.value=current;
     sel.title=this._chatModelProfiles().map(p=>p.label+': '+p.name).join(' · ')||'Choose models in Setup';
   }
 }
 async _syncVoiceStatus(){
   const button=this.composer?.querySelector('.oc-voice-settings');if(!button)return;
   const api=globalThis.ramoDesktop?.pocket;
   if(!api){button.textContent='Voice unavailable';button.disabled=true;return;}
   try{const data=await api.status();button.textContent='Voice: '+(data.enabled?'On':'Off');button.setAttribute('aria-pressed',String(data.enabled));}catch{button.textContent='Voice unavailable';}
 }
 async _showVoiceSettings(){
   const api=globalThis.ramoDesktop?.pocket;
   if(!api){alert('Pocket TTS controls require the Windows desktop application.');return;}
   const pane=this.composer;if(!pane)return;
   let pop=pane.querySelector('.oc-voice-panel');if(pop){pop.remove();return;}
   pop=document.createElement('div');pop.className='oc-voice-panel';
   pop.innerHTML='<strong>Pocket TTS · Ramo</strong><p class="oc-voice-explain">Voice runs on your CPU, off by default. First enable installs the Pocket TTS environment (internet and Python 3.10–3.14 required once). No M89 project or external server needed.</p><label>Voice <select class="oc-voice-choice"><option value="michael">Michael</option><option value="george">George</option><option value="alba">Alba</option><option value="lola">Lola</option></select></label><label>Language <select class="oc-voice-language"><option value="en">English</option><option value="es">Spanish</option></select></label><p class="oc-voice-path"></p><div class="oc-voice-row"><button type="button" class="oc-voice-enable">Enable voice</button><button type="button" class="oc-voice-close">Close</button></div><p class="oc-voice-message" role="status"></p>';
   pane.appendChild(pop);
   const q=s=>pop.querySelector(s),message=q('.oc-voice-message');let current={enabled:false};
   const refresh=async()=>{current=await api.status();q('.oc-voice-choice').value=current.voice;q('.oc-voice-language').value=current.language;q('.oc-voice-enable').textContent=current.enabled?'Disable voice':'Enable voice';q('.oc-voice-path').textContent=current.online?'Ramo Pocket engine connected':current.installing?'Installing Pocket TTS…':current.installed?'Pocket TTS installed · will start when enabled':'Pocket TTS will be installed on first enable';this._syncVoiceStatus();};
   q('.oc-voice-close').onclick=()=>pop.remove();
   q('.oc-voice-enable').onclick=async()=>{message.textContent=current.enabled?'Stopping local voice…':'Starting Pocket TTS setup… First-time dependency downloads may take a few minutes.';const button=q('.oc-voice-enable');button.disabled=true;try{await api.settings({enabled:!current.enabled,voice:q('.oc-voice-choice').value,language:q('.oc-voice-language').value});message.textContent=current.enabled?'Local voice stopped.':'Voice settings saved.';await refresh();}catch(e){message.textContent=e.message;await refresh();}finally{button.disabled=false;}};
   for(const selector of ['.oc-voice-choice','.oc-voice-language'])q(selector).onchange=async()=>{try{await api.settings({voice:q('.oc-voice-choice').value,language:q('.oc-voice-language').value});await refresh();}catch(e){message.textContent=e.message;}};
   try{await refresh();}catch(e){message.textContent=e.message;}
 }
 _clearEmbeddedPage(){if(!this.workspaceContent)return;for(const e of [...this.workspaceContent.children])try{e.remove();}catch(_){}}
 preparePage(page){
  page=String(page||'home').toLowerCase();if(!PAGE_META[page])page='home';this.currentPage=page;this._setVar(IDS.page,page);this._setupWorkspace();this._clearEmbeddedPage();this._setWorkspaceHeader();this.apply(true);return this.workspaceContent;
 }
 _requestHome(){const root=this.workspaceContent?.querySelector?.('.tam-workspace');if(root){try{root.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}catch(e){}if(root.isConnected)return;}this.showHome(true);}
 showHome(focus=false){
  this.currentPage='home';this._setVar(IDS.page,'home');this._setupWorkspace();this._clearEmbeddedPage();this._setWorkspaceHeader();this.apply(true);this._renderHome(true);if(focus){const input=document.getElementById('ramo-command-input-v180');input?.focus?.();}
 }
 getWorkspaceContentHost(){return this.workspaceContent;}
  _inlineSave(){
    if(this.inlinePersistTimer)clearTimeout(this.inlinePersistTimer);
    this.inlinePersistTimer=setTimeout(()=>{
      this.inlinePersistTimer=null;
      try{const clean={};for(const [chat,rows] of Object.entries(this.inlineRuns||{}))clean[chat]=(rows||[]).slice(-36).map(run=>globalThis.RamoHarnessCore?RamoHarnessCore.activitySnapshot(run):run);localStorage.setItem('ramo-inline-activity-v285',JSON.stringify(clean));}catch(_){}
    },350);
  }
  _syncThinkingButton(){const b=this.composer?.querySelector('.oc-thinking-quick'),api=this._chatAPI();if(!b)return;const on=!!api?.liveThinking;b.textContent=on?'Think on':'Think off';b.title=on?'Thinking is enabled; click to override and turn off':'Thinking is off; click to override and turn on';b.setAttribute('aria-pressed',String(on));}
  _initInlineEvents(){
    if(this.inlineUnsub)return;
    if(!this.inlineRuns){try{this.inlineRuns=JSON.parse(localStorage.getItem('ramo-inline-activity-v285')||'{}')||{}}catch(_){this.inlineRuns={}}}
    const api=this._chatAPI();this._syncThinkingButton();if(!api?.researchEvents?.subscribe)return;
    this.inlineUnsub=api.researchEvents.subscribe(evt=>this._onInlineEvent(evt));
    this._ensureInlineInteractions();
  }
  _ensureInlineInteractions(){
    if(this.inlineWire||!this.workspacePane)return;
    this.inlineWire=true;
    this.workspacePane.addEventListener('click',event=>{
      const edit=event.target.closest('[data-oc-turn-edit]');
      if(edit){this._startTurnEdit(Number(edit.dataset.ocTurnEdit));return;}
      const save=event.target.closest('[data-oc-turn-save]');
      if(save){this._saveTurnEdit(Number(save.dataset.ocTurnSave));return;}
      const cancel=event.target.closest('[data-oc-turn-cancel]');
      if(cancel){this._renderHome(true);return;}
      const remove=event.target.closest('[data-oc-turn-delete]');
      if(remove){this._removeTurn(Number(remove.dataset.ocTurnDelete),remove.dataset.ocKind||'exchange');return;}
      const retry=event.target.closest('[data-oc-turn-retry]');
      if(retry){this._retryTurn(Number(retry.dataset.ocTurnRetry));return;}
      const fork=event.target.closest('[data-oc-turn-fork]');if(fork){this._chatAPI().forkChatAt(Number(fork.dataset.ocTurnFork)).then(()=>this._pollChats()).catch(e=>this._showSmallStatus(e.message));return;}
      const copy=event.target.closest('[data-oc-message-copy]');
      if(copy){const msg=copy.closest('.ramo-w-chat.assistant');if(msg)this._copyAssistantMessage(msg);return;}
      const button=event.target.closest('[data-oc-inline-toggle]');
      if(button){const key=button.dataset.ocInlineToggle;this.inlineOpen??={};this.inlineOpen[key]=!(this.inlineOpen[key]??false);this._renderHome(true);return;}
      if(event.target.closest('[data-oc-inline-jump]')){const sc=this.workspaceContent?.querySelector('.ramo-chat-scroll');if(sc)sc.scrollTop=sc.scrollHeight;}
    });
    this.workspacePane.addEventListener('toggle',event=>{if(!event.target.matches?.('details[data-oc-inline-detail]'))return;this.inlineDetailOpen??={};this.inlineDetailOpen[event.target.dataset.ocInlineDetail]=event.target.open;},true);
    this.workspacePane.addEventListener('scroll',event=>{if(!event.target.classList?.contains('ramo-chat-scroll'))return;this.inlineScroll=event.target.scrollTop;},true);
  }
  _turnEditCheck(index){
    const list=this.chatView?.messages||[];
    if(!Number.isInteger(index)||index<0||index>=list.length)return null;
    if(this._chatAPI()?.session){this._showSmallStatus('Finish generating before editing messages.');return null;}
    return list[index];
  }
  _startTurnEdit(index){
    const turn=this._turnEditCheck(index);if(!turn)return;
    const card=this.workspaceContent?.querySelector(`.ramo-w-chat.user[data-oc-turn-index="${index}"]`);
    if(!card)return;
    card.querySelector('.oc-turn-editor')?.remove();
    const box=document.createElement('div');box.className='oc-turn-editor';
    const area=document.createElement('textarea');area.className='oc-turn-edit-input';area.value=turn.user;area.setAttribute('aria-label','Edit user message');area.rows=4;
    const actions=document.createElement('div');actions.className='oc-turn-edit-actions';
    const save=document.createElement('button');save.type='button';save.dataset.ocTurnSave=String(index);save.textContent='Save';
    const cancel=document.createElement('button');cancel.type='button';cancel.dataset.ocTurnCancel=String(index);cancel.textContent='Cancel';
    actions.append(save,cancel);box.append(area,actions);card.append(box);area.focus();area.setSelectionRange(area.value.length,area.value.length);
  }
  async _saveTurnEdit(index){
    const turn=this._turnEditCheck(index);if(!turn)return;
    const area=this.workspaceContent?.querySelector(`.ramo-w-chat.user[data-oc-turn-index="${index}"] .oc-turn-edit-input`);
    const updated=area?.value.trim();if(!updated){this._showSmallStatus('Message cannot be empty.');return;}
    if(updated===turn.user){this._renderHome(true);return;}
    const later=(this.chatView?.messages?.length||0)-index-1;
    if(!confirm('Save this edit as a new branch? The original answer and later messages remain in Chat tools → Conversation branches.'))return;
    try{
      await this._chatAPI().editChatMessageAt(index,updated);
      this._clearInlineAfter(index);await this._pollChats();this._showSmallStatus('Message saved. Select Regenerate to request a new answer.');
    }catch(e){this._showSmallStatus(e.message||String(e));}
  }
  _clearInlineAfter(index){
    const chat=String(this.chatView?.active||'main');
    if(this.inlineRuns?.[chat])this.inlineRuns[chat]=this.inlineRuns[chat].filter(r=>r.index<index);
    this.inlineRevision=(this.inlineRevision||0)+1;this._inlineSave();this.lastResponse='';
  }
  async _removeTurn(index,kind){
    const turn=this._turnEditCheck(index);if(!turn)return;
    const later=(this.chatView?.messages?.length||0)-index-1;
    const wording=kind==='reply'?'Delete this assistant answer?':'Delete this user message and its answer?';
    if(!confirm(wording+' The original conversation will remain available in Chat tools → Conversation branches.'))return;
    try{await this._chatAPI().deleteChatMessageAt(index,kind);this._clearInlineAfter(index);await this._pollChats();}
    catch(e){this._showSmallStatus(e.message||String(e));}
  }
  async _retryTurn(index){
    const turn=this._turnEditCheck(index);if(!turn)return;
    const later=(this.chatView?.messages?.length||0)-index-1;
    if(later&&!confirm('Regenerate from this message in a new branch? The original conversation will be saved.'))return;
    try{this._clearInlineAfter(index);await this._chatAPI().regenerateChatMessageAt(index);await this._pollChats();}
    catch(e){this._showSmallStatus(e.message||String(e));}
  }
  _copyAssistantMessage(card){
    const index=card.dataset.ocTurnIndex,content=index!==undefined?this.chatView?.messages?.[Number(index)]?.assistant:this._responseText();
    if(typeof content==='string')return this._copyText(content);
  }
  _onInlineEvent(evt){
    if(!evt?.chat_id||!globalThis.RamoHarnessCore)return;
    this.inlineRuns??={};this.inlineOpen??={};
    const chat=String(evt.chat_id),rows=this.inlineRuns[chat]??=[],api=this._chatAPI?.(),owner=api?.session?.chatId===chat?api.session:null;
    const stored=api?.engine?.store?.data?.chats?.find(c=>c.id===chat),index=Number.isInteger(evt.turn_index)?evt.turn_index:stored?.messages?.length??0;
    const id=evt.turn_id||owner?.turn?.activity?.id;
    let run=(id&&rows.findLast(r=>r.id===id))||(evt.call_id&&rows.findLast(r=>r.calls.some(c=>c.id===evt.call_id)));
    if(!run&&evt.type==='activity'&&evt.kind==='prompt'){run=RamoHarnessCore.createActivity(index,owner?.turn?.activity?.at||Date.now(),id);rows.push(run);}
    if(!run){if(!owner)return;run=rows.findLast(r=>!r.done&&r.index===index);if(!run){run=RamoHarnessCore.createActivity(index,Date.now(),id);rows.push(run);}}
    if(!RamoHarnessCore.recordActivity(run,evt)&&evt.kind!=='prompt')return;
    this.inlineRevision=(this.inlineRevision||0)+1;this._inlineSave();
    if(chat===this.chatView?.active&&this.currentPage==='home')this._queueInlineRender();
  }
  _queueInlineRender(){if(this.inlineRenderPending)return;this.inlineRenderPending=true;setTimeout(()=>{this.inlineRenderPending=false;if(this.currentPage==='home')this._renderHome();},130)}
  _inlineReady(){
    const active=this.chatView?.active||'main',api=this._chatAPI?.(),chat=api?.engine?.store?.data?.chats?.find(c=>c.id===active),messages=this.chatView?.messages||[],owner=api?.session?.chatId===active?api.session:null;
    this.inlineRuns??={};const rows=this.inlineRuns[active]??=[];let changed=false;
    // The message/attempt identity owns its timeline, including when branches share an index.
    for(let i=rows.length-1;i>=0;i--){const row=rows[i],message=messages[row.index],liveId=owner?.turn?.activity?.id,attemptId=chat?.attempt?.activity?.id;
      const stale=message?(message.activity&&row.id!==message.activity.id||message.editedAt&&!message.activity):!(row.id&&[liveId,attemptId].includes(row.id)||!row.id&&chat?.attempt&&row.index===messages.length);
      if(stale){rows.splice(i,1);changed=true;}
    }
    const hydrate=(record,index)=>{
      if(!record)return;const old=rows.findIndex(r=>r.id===record.id||!r.id&&r.index===index);
      if(old>=0&&rows[old].revision===record.revision&&rows[old].done===record.done&&rows[old].id===record.id)return;
      if(old>=0&&(rows[old].revision||0)>(record.revision||0))return;
      const row=JSON.parse(JSON.stringify(record));row.index=index;if(old>=0)rows[old]=row;else rows.push(row);changed=true;
    };
    messages.forEach((m,i)=>hydrate(m.activity,i));
    hydrate(owner?.turn?.activity,owner?.turn?.index??messages.length);
    if(!owner&&chat?.attempt?.activity)hydrate(chat.attempt.activity,chat.attempt.activity.index??messages.length);
    for(const row of rows)if(!row.done&&!owner&&!this.chatView?.busy&&(messages.length>row.index||Date.now()-row.at>750)){
      const ended=messages[row.index]?.at||Math.max(row.at,...row.calls.map(c=>(c.at||row.at)+(c.elapsed_ms||0)));
      if(globalThis.RamoHarnessCore)RamoHarnessCore.finishActivity(row,messages.length>row.index?(messages[row.index]?.status||'complete'):'interrupted',ended);else{row.done=true;row.elapsed_ms=Math.max(0,ended-row.at);}
      changed=true;
    }
    rows.sort((a,b)=>a.index-b.index||a.at-b.at);if(changed){this.inlineRevision=(this.inlineRevision||0)+1;this._inlineSave();}return rows;
  }
  _inlineSafeURL(value){try{const u=new URL(value);if(!/^https?:$/.test(u.protocol))return '';u.username='';u.password='';for(const k of [...u.searchParams.keys()])if(/key|token|secret|pass|auth/i.test(k))u.searchParams.set(k,'[hidden]');return u.href;}catch(_){return '';}}
  _ocMetricsHTML(call,key,escInline,summaryLabel='Performance'){
    const m=call.metrics;if(!m||typeof m!=='object')return '';
    const rate=n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n).toFixed(1):null;
    const whole=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))&&Number(n)>=0?Math.round(Number(n)).toLocaleString('en-US'):null;
    const ms=n=>Number.isFinite(Number(n))&&Number(n)>0?(Number(n)/1000).toFixed(2)+'s':null;
    const outRate=rate(m.output_tps),inRate=rate(m.prompt_tps),outCount=whole(m.output_tokens),inCount=whole(m.prompt_tokens),cached=whole(m.prompt_cached_tokens);
    const details=[
      ['Generation speed',outRate?outRate+' tokens/s':'Not reported'],
      ['Prompt processing',inRate?inRate+' tokens/s':'Not reported'],
      ['Input tokens',inCount??'Not reported'],['Generated tokens',outCount??'Not reported'],
      ['Cached input tokens',cached??'Not reported'],
      ['Prompt time',ms(m.prompt_ms)??'Not reported'],['Generation time',ms(m.output_ms)??'Not reported'],
      ['Model load',ms(m.load_ms)??'Not reported'],['Total request',ms(m.wall_ms)??'Not reported'],
      ['First streamed chunk',ms(m.time_to_first_chunk_ms)??'Not reported']
    ];
    const detailKey=key+':performance:'+call.id;
    return '<details class="oc-inline-details oc-inline-metrics" data-oc-inline-detail="'+escInline(detailKey)+'" '+(this.inlineDetailOpen?.[detailKey]?'open':'')+'><summary>'+escInline(summaryLabel)+(summaryLabel==='Details'?'':(outRate?' · '+outRate+' tok/s':''))+'</summary><div class="oc-inline-metrics-grid">'
      +details.map(([label,value])=>'<span>'+escInline(label)+'</span><strong>'+escInline(value)+'</strong>').join('')
      +'</div><div class="oc-inline-mute">'+(m.provider==='ollama'?'Speeds come from Ollama completion timings; output includes thinking tokens.':'Token speeds unavailable: this endpoint did not return generation timings.')+'</div></details>';
  }
  _ocResponseStatsHTML(run){
    // Keep these measurements visible after a generation, even if the activity
    // timeline is collapsed or the conversation is reopened later.
    const calls=(run?.calls||[]).filter(c=>c.status==='done'&&c.metrics&&typeof c.metrics==='object');
    if(!calls.length)return '';
    const call=[...calls].reverse().find(c=>Number(c.metrics.output_tps)>0)||calls[calls.length-1];
    const m=call.metrics;
    const fmt=n=>Number.isFinite(Number(n))&&Number(n)>0?Number(n).toFixed(1):null;
    const count=n=>n!==null&&n!==undefined&&Number.isFinite(Number(n))&&Number(n)>=0?Math.round(Number(n)).toLocaleString('en-US'):null;
    const speed=fmt(m.output_tps),tokens=count(m.output_tokens);
    const elapsed=fmt((Number(m.wall_ms)||0)/1000);
    const runKey=(this.chatView?.active||'main')+':'+run.index;
    const escapeStats=x=>esc(String(x??''));
    const chips=[];
    if(speed)chips.push(speed+' tok/s');
    if(tokens!==null)chips.push(tokens+' generated');
    if(!speed&&elapsed)chips.push(elapsed+'s request');
    if(calls.length>1)chips.push(calls.length+' calls');
    if(!chips.length)chips.push('Timings available');
    const info=this._ocMetricsHTML(call,runKey,escapeStats,'Details');
    return '<div class="oc-response-stats" data-oc-node="'+escapeStats(runKey+':response-stats')+'">'
      +'<span class="oc-response-stats-name">Inference</span><span class="oc-response-stats-values">'+escapeStats(chips.join(' · '))+'</span>'
      +info+'</div>';
  }
  _inlineActivityHTML(run){
    if(!run)return '';
    const key=(this.chatView?.active||'main')+':'+run.index,open=this.inlineOpen?.[key]===undefined?!run.done:!!this.inlineOpen[key];
    const escInline=s=>esc(String(s??'').replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret|password|authorization)=)[^&#\s]+/gi,'$1[hidden]'));
    const searches=run.steps.filter(s=>s.kind==='search').length,reads=run.steps.filter(s=>s.kind==='read').length;
    const reasoning=run.calls.some(c=>c.thinking?.trim()),live=!run.done;
    const label=live?'Working · live activity':((run.imported?'Imported activity · ':'')+({interrupted:'Stopped after ',failed:'Failed after ',partial:'Response limit reached · '}[run.status]||'Completed in ')+Math.max(1,Math.round((run.elapsed_ms||0)/1000))+'s'+(searches?' · '+searches+' search'+(searches===1?'':'es'):'')+(reads?' · '+reads+' read attempt'+(reads===1?'':'s'):''));
    const lastTimed=[...run.calls].reverse().find(c=>Number(c.metrics?.output_tps)>0);
    const perfLabel=lastTimed?' · '+Number(lastTimed.metrics.output_tps).toFixed(1)+' gen tok/s':'';
    let body=run.storageLimited?'<div class="oc-inline-muted">Some reasoning or step details were omitted to save the conversation because local storage was full.</div>':'';
    const timeline=[...run.steps.map((s,i)=>({at:s.at||run.at||0,s,i})),...run.calls.map((call,i)=>({at:call.at||run.at||0,call,i}))].sort((a,b)=>a.at-b.at);
    for(const item of timeline){
     if(item.s){
      const i=item.i,s=item.s,names={search:'Searched the web',search_result:'Search results',read:s.status==='pending'?'Reading a source':s.status==='read'?'Read a source':s.status?'Source read '+s.status:'Read requested · result unavailable',recall:'Checked memory',route:'Chose a method',tool:'Used a tool',prompt:'Understood request',error:'Tool error'};
      const url=this._inlineSafeURL(s.message),showLink=s.kind==='read'&&url;
      const description=showLink?'<a class="oc-inline-link" href="'+escInline(url)+'" target="_blank" rel="noopener noreferrer">'+escInline(s.message)+'</a>':escInline(s.message);
      let resultsHTML=s.kind==='read'?'<div class="oc-inline-result-status">'+escInline(s.status==='read'?((s.cached?'Saved content':'Retrieved content')+' · '+(s.characters||0)+' characters'):s.error||s.status||'Result not recorded')+'</div>':'';
      if(s.kind==='search'&&s.resultsReceived){
        const sources=Array.isArray(s.sources)?s.sources:[];
        const failed=s.searchStatus==='provider_failed';
        resultsHTML+='<div class="oc-inline-result-status">'+(s.cached?'Saved search · ':'')+(failed?'Search provider failed':sources.length+' source'+(sources.length===1?'':'s')+' listed')+'</div>';
        if(s.searchError)resultsHTML+='<div class="oc-inline-result-status">'+escInline(s.searchError)+'</div>';
        if(sources.length){
          resultsHTML+='<div class="oc-inline-sources">';
          for(let si=0;si<sources.length;si++){
            const source=sources[si],href=this._inlineSafeURL(source.url);
            if(!href)continue;
            let domain='';try{domain=new URL(href).hostname.replace(/^www\./,'');}catch(_){}
            const srcKey=key+':source:'+i+':'+si;
            resultsHTML+='<div class="oc-inline-source" data-oc-node="'+escInline(srcKey)+'">'
              +'<a class="oc-inline-source-link" href="'+escInline(href)+'" target="_blank" rel="noopener noreferrer">'+escInline(source.title||domain||'Source')+' ↗</a>'
              +'<div class="oc-inline-source-meta">'+escInline(domain)+(source.published?' · '+escInline(source.published):'')+'</div>'
              +(source.snippet?'<details class="oc-inline-details" data-oc-inline-detail="'+escInline(srcKey)+'" '+(this.inlineDetailOpen?.[srcKey]?'open':'')+'><summary>Preview from search</summary><div class="oc-inline-pre">'+escInline(source.snippet)+'</div></details>':'')
              +'</div>';
          }
          resultsHTML+='</div><div class="oc-inline-result-status">Search results are discovery leads; opening or verifying a page is a separate step.</div>';
        }
      }
      const detailKey=key+':step:'+i;
      body+='<div class="oc-inline-step" data-oc-node="'+escInline(key+':step:'+i)+'"><div class="oc-inline-kind">'+escInline(names[s.kind]||s.kind.replace(/_/g,' '))+'</div><div class="oc-inline-muted">'+description+'</div>'+resultsHTML+(s.why?'<details class="oc-inline-details" data-oc-inline-detail="'+escInline(detailKey)+'" '+(this.inlineDetailOpen?.[detailKey]?'open':'')+'><summary>Why / details</summary><div class="oc-inline-pre">'+escInline(s.why)+'</div></details>':'')+'</div>';
     }else{
      const call=item.call;
      if(!call.thinking&&!call.output&&!live&&!call.metrics)continue;
      const detailKey=key+':call:'+call.id;
      const reason=call.thinking?.trim();
      body+='<div class="oc-inline-step" data-oc-node="'+escInline(detailKey)+'"><div class="oc-inline-kind">'+escInline(call.stage==='chat'?'Model response':'Model · '+call.stage)+'</div><div class="oc-inline-muted">'+escInline(call.model)+(call.status==='running'?' · streaming…':'')+'</div>';
      if(reason){body+='<details class="oc-inline-details" data-oc-inline-detail="'+escInline(detailKey)+'" '+(this.inlineDetailOpen?.[detailKey]===undefined ? (call.status==='running' ? 'open' : '') : (this.inlineDetailOpen[detailKey] ? 'open' : ''))+'><summary>Actual model thinking'+(call.status==='running'?' · live':'')+'</summary><div class="oc-inline-pre">'+escInline(reason)+(call.thinkingTruncated?'\n[Earlier reasoning text omitted by the display limit.]':'')+'</div></details>'}
      else if(call.thinkingOmitted)body+='<div class="oc-inline-muted">Thinking text was omitted to preserve the saved answer because local storage was full.</div>';
      else if(call.thinkingEnabled===false)body+='<div class="oc-inline-muted">Reasoning was disabled for this call.</div>';
      else body+='<div class="oc-inline-muted">The model did not expose separate reasoning text.</div>';
      if(live&&call.status==='running'&&call.output&&/^chat(?:_agent(?:_finish|_recover)?)?$|final|report/i.test(call.stage))body+='<div class="oc-inline-stream"><div class="oc-inline-muted">Streaming draft text · not yet verified</div>'+escInline(call.output)+'</div>';
      if(call.status!=='running')body+=this._ocMetricsHTML(call,key,escInline);
      body+='</div>';
     }
    }
    if(run.hiddenSteps||run.hiddenCalls)body+='<div class="oc-inline-muted">Earlier display entries omitted ('+(run.hiddenSteps||0)+' activities, '+(run.hiddenCalls||0)+' calls). Source/tool records remain with the conversation; this thinking view is bounded.</div>';
    if(!body)body='<div class="oc-inline-muted">Waiting for model or tool events. Only actual activity is shown.</div>';
    return '<section class="oc-inline-activity" data-open="'+(open?'1':'0')+'"><button type="button" class="oc-inline-title" data-oc-inline-toggle="'+escInline(key)+'" aria-expanded="'+(open?'true':'false')+'"><span>◌</span><span>'+escInline(label+perfLabel)+'</span><span class="oc-inline-caret">⌄</span></button>'+(open?'<div class="oc-inline-body">'+body+'</div>':'')+'</section>';
  }
  _ocReconcileNode(current, desired){
    if(!current||!desired||current.nodeType!==desired.nodeType||current.nodeName!==desired.nodeName){
      const result=desired.cloneNode(true);current?.replaceWith(result);return result;
    }
    if(current.nodeType===3||current.nodeType===8){
      if(current.nodeValue!==desired.nodeValue)current.nodeValue=desired.nodeValue;
      return current;
    }
    if(current.nodeType!==1)return current;
    for(const attr of [...current.attributes])if(!desired.hasAttribute(attr.name))current.removeAttribute(attr.name);
    for(const attr of [...desired.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
    // Keep existing elements and scrollTop, including the live thinking <div>, rather than remounting.
    let i=0;
    for(const next of [...desired.childNodes]){
      let existing=current.childNodes[i];
      // A tool step can be inserted before an already-streaming model call.
      // Match these blocks by identity, not by their changing array position.
      if(next.nodeType===1 && next.hasAttribute('data-oc-node')){
        const nodeKey=next.getAttribute('data-oc-node');
        const matched=[...current.children].find(el=>el.getAttribute('data-oc-node')===nodeKey);
        if(matched && matched!==existing){current.insertBefore(matched,existing||null);existing=matched;}
        else if(!matched){current.insertBefore(next.cloneNode(true),existing||null);i++;continue;}
      }
      if(!existing)current.appendChild(next.cloneNode(true));
      else this._ocReconcileNode(existing,next);
      i++;
    }
    while(current.childNodes.length>i)current.lastChild.remove();
    return current;
  }
  _ocScrollSnapshot(chatId){
    if(!chatId)return;
    this._ocScrollByChat??={};
    const root=this.workspaceContent?.querySelector('.ramo-chat-scroll');
    if(!root)return;
    const nested={};
    for(const el of root.querySelectorAll('details[data-oc-inline-detail] .oc-inline-pre')){
      const id=el.closest('details')?.dataset.ocInlineDetail;
      if(id)nested[id]=el.scrollTop;
    }
    this._ocScrollByChat[chatId]={main:root.scrollTop,nested};
  }
  _ocScrollRestore(chatId,root){
    const saved=this._ocScrollByChat?.[chatId];if(!saved||!root)return;
    root.scrollTop=saved.main||0;
    for(const el of root.querySelectorAll('details[data-oc-inline-detail] .oc-inline-pre')){
      const id=el.closest('details')?.dataset.ocInlineDetail;
      if(id && Object.prototype.hasOwnProperty.call(saved.nested,id))el.scrollTop=saved.nested[id];
    }
  }
  _renderHome(force=false){
    if(this.currentPage!=='home'||!this.workspaceContent)return;
    this._initInlineEvents();
    const data=this.chatView||{},msgs=Array.isArray(data.messages)?data.messages:[],text=this._responseText(),rows=this._inlineReady();
    const api=this._chatAPI(),attempt=api?.engine?.store?.activeChat?.()?.attempt;
    const live=api?.session?.turn?.raw||((rows.at(-1)?.index>=msgs.length&&attempt)?attempt.user:'')||'';
    // The message of the turn in flight, when the store already holds it.
    // Only that message may stand in for the turn: an earlier turn with the
    // same question, or with the same answer, is a different turn.
    const turnIndex=Number.isInteger(api?.session?.turn?.index)?api.session.turn.index:-1;
    const current=turnIndex>=0&&turnIndex<msgs.length?msgs[turnIndex]:null;
    const latest=rows.at(-1),key=(data.active||'main')+'|'+msgs.length+'|'+String(msgs.at(-1)?.assistant||'').length+'|'+text+'|'+live+'|'+(this.inlineRevision||0);
    if(!force&&key===this.lastResponse)return;
    if(!force&&this.workspaceContent.querySelector('.oc-turn-editor'))return;
    const currentChat=String(data.active||'main');
    const old=this.workspaceContent.querySelector('.ramo-chat-scroll');
    const previousChat=this._ocRenderedChat;
    if(old&&previousChat&&previousChat!==currentChat)this._ocScrollSnapshot(previousChat);
    const switching=!!old && previousChat!==currentChat;
    const scroll=old&&!switching?old:document.createElement('div');
    scroll.className='ramo-chat-scroll';
    const read=document.createElement('div');read.className='ramo-reading';
    if(msgs.length){
      for(let i=0;i<msgs.length;i++){
        const m=msgs[i];
        if(String(m.user||'').trim()){
          const card=document.createElement('article');card.className='ramo-w-chat user';card.dataset.ocTurnIndex=String(i);
          const speaker=document.createElement('div');speaker.className='oc-speaker';speaker.textContent='YOU';const body=document.createElement('div');body.innerHTML=this._renderMarkdown(m.user);
          const actions=document.createElement('div');actions.className='oc-message-actions';actions.innerHTML='<button type="button" data-oc-turn-fork="'+i+'" aria-label="Fork conversation" title="Fork conversation">⑂</button><button type="button" data-oc-turn-edit="'+i+'" aria-label="Edit message" title="Edit message">✎</button><button type="button" data-oc-turn-delete="'+i+'" data-oc-kind="exchange" aria-label="Delete message" title="Delete message">⌫</button><button type="button" data-oc-turn-retry="'+i+'" aria-label="Regenerate response" title="Regenerate response">↻</button>';
          card.append(speaker,body);const pictures=(m.attachments||[]).filter(a=>a.kind==='images').flatMap(a=>a.images||[]);if(pictures.length&&globalThis.RamoImages)card.append(globalThis.RamoImages.thumbnails(pictures));card.append(actions);read.append(card);
        }
        const run=rows.findLast(x=>x.index===i);if(run){const holder=document.createElement('div');holder.innerHTML=this._inlineActivityHTML(run);read.append(holder.firstElementChild);}
        if(String(m.assistant||'').trim()){
          const card=document.createElement('article');card.className='ramo-w-chat assistant';card.dataset.ocTurnIndex=String(i);const speaker=document.createElement('div');speaker.className='oc-speaker';speaker.textContent=m.status==='partial'?'RAMO · Partial — response limit reached':'RAMO';const body=document.createElement('div');body.innerHTML=this._renderMarkdown(m.assistant);card.append(speaker,body);const statsHTML=this._ocResponseStatsHTML(run);if(statsHTML){const statsWrap=document.createElement('div');statsWrap.innerHTML=statsHTML;card.append(statsWrap.firstElementChild);}const actions=document.createElement('div');actions.className='oc-message-actions';actions.innerHTML='<button type="button" class="oc-message-copy" data-oc-message-copy="1" aria-label="Copy assistant message" title="Copy message">⧉</button><button type="button" data-oc-turn-retry="'+i+'" aria-label="Regenerate response" title="Regenerate response">↻</button><button type="button" data-oc-turn-delete="'+i+'" data-oc-kind="reply" aria-label="Delete message" title="Delete message">⌫</button>';card.append(actions);read.append(card);
        }
      }
    }
    else if(!data.busy){
      // A turn in flight has no message in the store yet, so the question and
      // the answer streaming after it are added below, in that order.
      if(text&&!/^Ready[.!](?:\s|$)/i.test(text))read.innerHTML=this._renderMarkdown(text);
      else read.innerHTML='<div class="ramo-empty"></div>';
    }
    // The question of the turn in flight is not in the store until the turn
    // ends, so it is drawn from the live turn. It must come before the answer
    // that is streaming after it, not after it.
    const asked=!!String(live||'').trim()&&(!current||String(current.user||'')!==live);
    if(latest&&latest.index>=msgs.length){
      if(asked){const card=document.createElement('article');card.className='ramo-w-chat user';const speaker=document.createElement('div');speaker.className='oc-speaker';speaker.textContent='YOU';const body=document.createElement('div');body.textContent=live;card.append(speaker,body);read.append(card);}
      const holder=document.createElement('div');holder.innerHTML=this._inlineActivityHTML(latest);read.append(holder.firstElementChild);
    }else if(asked){const card=document.createElement('article');card.className='ramo-w-chat user';card.textContent='YOU · '+live;read.append(card);}
    // The answer being streamed comes last, after the question it answers.
    // It is only left out when the store already holds this very answer for
    // this very turn, which is the moment the turn is written down.
    if(data.busy&&text&&text!==String(current?.assistant||'')&&!/^Ready[.!](?:\s|$)/i.test(text)){const card=document.createElement('article');card.className='ramo-w-chat assistant';card.innerHTML='<div class="oc-speaker">RAMO · LIVE</div>'+this._renderMarkdown(text)+'<div class="oc-message-actions"><button class="oc-message-copy" type="button" data-oc-message-copy="1" title="Copy message">⧉</button></div>';read.append(card);}
    if(old&&!switching){
      const currentRead=old.querySelector('.ramo-reading');
      if(currentRead)this._ocReconcileNode(currentRead,read);
      else old.appendChild(read);
    }else{
      scroll.appendChild(read);
      this.workspaceContent.replaceChildren(scroll);
      this._ocScrollRestore(currentChat,scroll);
    }
    this._ocRenderedChat=currentChat;
    this.inlineScroll=scroll.scrollTop;
    // Streaming leaves *all* scroll positions alone. The Latest control is explicit.
    let jump=this.workspaceContent.querySelector('.oc-inline-jump');
    if(scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight>130){
      if(!jump){jump=document.createElement('button');jump.className='oc-inline-jump';jump.textContent='↓ Latest message';jump.setAttribute('data-oc-inline-jump','1');this.workspaceContent.append(jump);}
    }else jump?.remove();
    this.lastResponse=key;
    if(this.chatMenuOpen)this._renderChatMenu();
  }

 _chatAPI(){return globalThis.__ramoAssistantInstance||null;}
 async _pollChats(){
  if(this._chatPollInFlight){this._chatPollAgain=true;return this._chatPollInFlight;}
  const api=this._chatAPI();if(!api)return;
  this._chatPollInFlight=(async()=>{try{const info=await api.listChatSessions(),active=api.engine?.store?.data?.activeChatId;
   if(active&&info.active!==active){this._chatPollAgain=true;return;}
   this.chatView=info;this._renderDrawerChats();this._setWorkspaceHeader();this._syncThinkingButton();this._renderHome();if(this.chatMenuOpen)this._renderChatMenu();
  }catch(e){if(Date.now()-(this._chatPollErrorAt||0)>10000){this._chatPollErrorAt=Date.now();this._showSmallStatus?.('Conversation list unavailable. Reopen the chat or retry.');}}
  finally{this._chatPollInFlight=null;if(this._chatPollAgain){this._chatPollAgain=false;await this._pollChats();}}})();return this._chatPollInFlight;
 }
 async _doChatAction(type,id){const api=this._chatAPI();if(!api)return;
  try{if(type==='new')await api.createChatSession();else if(type==='select')await api.selectChatSession(id);
   else if(type==='rename'){const c=(this.chatView.chats||[]).find(c=>c.id===id),title=prompt('Rename chat',c?.title||'');if(title!==null)await api.renameChatSession(id,title);}
   else if(type==='delete'){if(confirm('Delete this chat and its visible history?')){await api.deleteChatSession(id);if(this.inlineRuns)delete this.inlineRuns[id];this._inlineSave();}}
   this.chatMenuOpen=false;await this._pollChats();this.showHome(false);
  }catch(e){alert(e.message||String(e));}
 }
 _renderDrawerChats(){
  const box=this.navShell?.querySelector('.ramo-drawer-chat-list');if(!box)return;
  const chats=this.chatView?.chats||[];const selected=this.chatView?.active;
  const query=this.chatSearch||'';const searchRevision=query?JSON.stringify(this._chatAPI()?.engine.store.data.chats.map(c=>[c.id,c.messages])):'';const stamp=searchRevision+'|'+query+'|'+!!this.showArchived+'|'+chats.map(c=>c.id+':'+c.title+':'+!!c.pinned+':'+!!c.archived).join('|')+'#'+selected;
  if(box.dataset.stamp===stamp)return;
  box.dataset.stamp=stamp;box.replaceChildren();
  for(const chat of chats.filter(c=>(this.showArchived||!c.archived||c.id===selected)&&(!query||((c.title||'')+' '+(this._chatAPI()?.engine.store.data.chats.find(x=>x.id===c.id)?.messages||[]).map(m=>m.user+' '+m.assistant).join(' ')).toLowerCase().includes(query))).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)).slice(0,100)){
    const button=document.createElement('button');button.type='button';button.className='ramo-drawer-chat-entry'+(chat.id===selected?' active':'');
    button.dataset.chatId=chat.id;button.textContent=(chat.pinned?'★ ':'')+(chat.id==='main'?'Main':chat.title||'Untitled chat')+(chat.archived?' · archived':'');button.title=button.textContent;
    box.appendChild(button);
  }
 }
 _toggleChatMenu(){this.chatMenuOpen=!this.chatMenuOpen;if(this.chatMenuOpen)this._renderChatMenu();else document.getElementById('ramo-chat-menu-v1')?.remove();}
 _renderChatMenu(){if(!this.workspacePane)return;let menu=this.workspacePane.querySelector('#ramo-chat-menu-v1');if(!this.chatMenuOpen){menu?.remove();return;}
  if(!menu){menu=document.createElement('div');menu.id='ramo-chat-menu-v1';menu.className='oc-chat-menu';this.workspacePane.append(menu);}
  menu.replaceChildren();for(const c of (this.chatView.chats||[]).filter(c=>!c.archived||c.id===this.chatView.active)){const row=document.createElement('div');row.className='oc-chat-option'+(c.id===this.chatView.active?' active':'');
   const title=document.createElement('button');title.className='oc-chat-title';title.textContent=c.id==='main'?'★ Main':c.title;title.onclick=()=>this._doChatAction('select',c.id);row.append(title);
   if(c.id!=='main'){const rename=document.createElement('button');rename.textContent='✎';rename.title='Rename';rename.onclick=()=>this._doChatAction('rename',c.id);row.append(rename);
    const del=document.createElement('button');del.textContent='×';del.title='Delete';del.onclick=()=>this._doChatAction('delete',c.id);row.append(del);}
   menu.append(row);
  }
 }

 async _copyText(text){if(!text)return;try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else{const a=document.createElement('textarea');a.value=text;a.style.position='fixed';a.style.opacity='0';document.body.append(a);a.select();document.execCommand?.('copy');a.remove();}}catch(e){this._showSmallStatus('Copy failed');}}
 async _copyLatest(){return this._copyText(this._responseText());}
 _syncVisibility(){const hidden=Number(this._getVar('tamai_shell_hidden_v1',0))||0;if(this.composer)this.composer.style.display=(hidden||this.currentPage!=='home')?'none':'flex';if(this.workspacePane)this.workspacePane.style.display=hidden?'none':'flex';if(this.navShell)this.navShell.style.display=hidden?'none':'block';this.lastHidden=hidden;}
 _syncComposerState(force=false){
  if(!this.composer)return;const busy=Number(this._getVar('tamai_shell_busy_v1',0))||0,micOn=Number(this._getVar('tamai_shell_mic_in_v1',0))||0,mic=document.getElementById('ramo-composer-mic'),send=document.getElementById('ramo-composer-send');
  if(mic&&(force||micOn!==this.lastMic)){mic.innerHTML=micOn?MIC_ON:MIC_OFF;mic.setAttribute('aria-label',this._sttActive?'Stop speech recognition':micOn?'Listening · speech to text':'Microphone · speech to text');mic.title=this._sttActive?'Stop speech recognition':micOn?'Listening for speech':'Speech to text';mic.setAttribute('aria-pressed',(micOn||this._sttActive)?'true':'false');this.lastMic=micOn;}
  if(this.navShell){for(const b of this.navShell.querySelectorAll('[data-act="mic"]')){b.classList.toggle('listening',!!micOn);b.setAttribute('aria-pressed',(micOn||this._sttActive)?'true':'false');b.setAttribute('aria-label',micOn?'Listening for speech':'Start speech to text');}const s=this.navShell.querySelector('.ramo-mic-status');if(s)s.textContent=micOn?'Listening…':'Ready to listen';}
  const draft=!!document.getElementById('ramo-command-input-v180')?.value.trim(),sendState=busy+':'+draft;
  if(send&&(force||sendState!==this.lastSendState)){send.style.opacity='1';send.style.cursor='pointer';send.disabled=false;send.innerHTML=busy?(draft?'↳':'■'):'↑';send.setAttribute('aria-label',busy?(draft?'Queue follow-up':'Stop generation'):'Send');send.title=busy?(draft?'Queue follow-up':'Stop generation'):'Send message (Enter)';this.lastBusy=busy;this.lastSendState=sendState;}
 }
 _tick(){if(!this.started)return;
   if(typeof document!=='undefined'&&!document.hidden&&Date.now()-this.ollamaInventoryLast>60000)this._refreshOllamaInventory(false);if(Date.now()-this.lastChatPoll>700){this.lastChatPoll=Date.now();this._pollChats();}const d=this._layoutDims();if(d.stageW!==this.lastStageW||d.stageH!==this.lastStageH){this.apply(true);return;}this._positionOverlayRoot();const pi=this._hideProjectPrompt();if(!this.composer&&pi)this._setupComposer();if(!this.workspacePane)this._setupWorkspace();if(!this.navShell)this._setupNavigation();this._syncVisibility();this._syncComposerState(false);if(this.currentPage==='home'){const has=this._conversationOccupied();if(has!==this.hasAnswerLayout){this.hasAnswerLayout=has;this.apply(true);return;}this._renderHome(false);}if((++this.auditTick%4)===0)this._updateCoreState();if(Date.now()>this.suppressMirrorUntil){const v=document.getElementById('ramo-command-input-v180'),active=document.activeElement===v,pv=this._readProjectPrompt();if(v&&!active&&pv&&v.value!==pv)v.value=pv;}this._setVisible('Voice Output',false);}
 _finishApply(dims,mode){if(!this._drawerInitialized){this._drawerInitialized=true;this.drawerOpen=!!(this.windowMode&&dims.stageW>=1150);}const g=this._geometry(dims.stageW,dims.stageH,mode);this.lastLayout=g;this._ensureBackground(dims.stageW,dims.stageH,g);this._applyLayout(g);this._ensureOverlayRoot();this._positionOverlayRoot();this._setupNavigation();this._setupComposer();this._setupWorkspace();this._ensureDesignStyle();this._publishContentBox(g.contentBox);this._styleNavigation(g);this._styleComposer(g);this._styleWorkspace(g);this._styleArtwork(g);this._setWorkspaceHeader();this._syncComposerState(true);if(this.currentPage==='home')this._renderHome();this._syncVisibility();}
apply(force=false){const dims=this._layoutDims(),mode=this._modeFor(dims.stageW,dims.stageH);if(!force&&dims.stageW===this.lastStageW&&dims.stageH===this.lastStageH){this._syncViewport(true);return;}this.lastStageW=dims.stageW;this.lastStageH=dims.stageH;this._finishApply(dims,mode);}
}
export {RamoWorkspaceUI};

