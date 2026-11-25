/**
 * The unified surface.
 *
 * Chat and Work are one session service with one capability set: the same
 * files, the same search, the same shell and the same web tools, wherever the
 * conversation is held. This module makes that visible in the conversation,
 * and overhauls the conversation to the calmer language the reference
 * designs (Muse, OpenCode, Grok) share:
 *
 *   wide column (never the 720px the research suggested), user bubbles as the
 *   accent, assistant bubbles quiet, internal measurements hidden but kept in
 *   a Details panel in the right rail, an identity in the header,
 *   one calm line in the empty state, and a composer that shows scope as
 *   chips before anything is sent.
 *
 * The right rail is the Work look kept as a rail instead of a mode: what
 * changed (files with diffs, red/green), what is running right now (a live
 * status pill with Stop), the plan from the conversation's task list, and the
 * hidden Details.
 *
 * This is presentation only. It never decides what the model may do. The
 * runtime owns the capability set, the permission check and the memory
 * isolation, and the bar only reports what the runtime says.
 */
(function () {
	'use strict';
	const runtime = window.RamoRuntime;
	if (!runtime) return;
	const model = window.RamoChatModel || null;
	const instance = () => globalThis.__ramoAssistantInstance || null;
	const el = (tag, text, cls) => {
		const node = document.createElement(tag);
		if (text !== undefined) node.textContent = text;
		if (cls) node.className = cls;
		return node;
	};
	const svg = (markup, cls) => {
		const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		node.setAttribute('viewBox', '0 0 24 24');
		node.setAttribute('aria-hidden', 'true');
		if (cls) node.setAttribute('class', cls);
		node.innerHTML = markup;
		return node;
	};

	/** The style of the unified surface. It follows the Work page. */
	//
	// The selectors carry two ids on purpose. The chat shell injects its own
	// stylesheet with the same selectors and the same `!important`, and it is
	// injected later, so a rule of equal specificity would lose on order.
	// The second id makes the unified look win on specificity instead.
	const STYLE = `
/* The unified surface: the conversation is drawn like the Work page. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-chat-scroll{padding:18px clamp(10px,2vw,30px) 24px!important;scrollbar-color:#586461 transparent!important}
@media (min-width:1500px){#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-chat-scroll{padding-left:0!important;padding-right:0!important}}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading{max-width:1100px!important;margin:0 auto!important;color:var(--oc-text,#edf1ef)!important;font:400 14px/1.62 "Segoe UI",system-ui,sans-serif!important}
/* The rail is docked at the window's right edge and everything reflows around it. The pane and the
   composer centre themselves in the space between the sidebar and the rail (set as --oc-content-x /
   --oc-content-w from measured edges each refresh; the fallbacks match the 1920 layout). */
#ramo-stage-overlay-v180:not(.oc-rail-closed) #ramo-workspace-pane-v180{left:var(--oc-content-x,460px)!important;right:auto!important;width:var(--oc-content-w,916px)!important}
#ramo-stage-overlay-v180:not(.oc-rail-closed) #ramo-composer-v180{left:var(--oc-content-x,460px)!important;right:auto!important;width:var(--oc-content-w,916px)!important}
#ramo-stage-overlay-v180:not(.oc-rail-closed) #ramo-workspace-content-v180 .ramo-chat-scroll{inset:0!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading p{margin:0 0 12px!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading p:last-child{margin-bottom:0!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading h1,#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading h2,#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading h3,#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading h4{color:var(--oc-text,#edf1ef)!important;margin:18px 0 9px!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading a{color:var(--oc-accent,#a0c4b0)!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading strong{color:var(--oc-text,#edf1ef)!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading code{background:var(--oc-field,#292e30)!important;color:var(--oc-soft,#d1d6d3)!important;border-radius:5px;padding:2px 5px;font-size:12.5px}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading pre{background:var(--oc-field,#292e30)!important;border:1px solid var(--oc-rule,#3e4545)!important;border-radius:10px!important;padding:12px 14px!important;overflow:auto!important;scrollbar-color:#586461 transparent}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading pre code{background:none!important;padding:0!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading blockquote{border-left:2px solid var(--oc-rule,#454d4e);margin:0 0 12px;padding-left:12px;color:var(--oc-muted,#a8b4b1)}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-markdown-table{overflow:auto;margin:0 0 12px!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-markdown-table table{border-collapse:collapse;font-size:13px}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-markdown-table th,#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-markdown-table td{border:1px solid var(--oc-rule,#3e4545);padding:6px 10px;text-align:left}

/* A code block collapses to a few lines by default; the language and line
   count stay visible, the code is one click away. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading pre.oc-code-collapsible{max-height:260px;overflow:auto}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-reading pre.oc-code-expanded{max-height:none}

/* Bubbles: opposite sides, like every chat app. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat{margin:12px auto 18px!important;padding:0!important;border:0!important;border-radius:0!important;background:none!important;box-shadow:none!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user{margin:12px 0 18px auto!important;width:fit-content;max-width:min(760px,82%);padding:11px 16px!important;border-radius:18px 18px 6px 18px;background:var(--oc-accent,#a0c4b0)!important;color:var(--oc-bg,#1f2123)!important;font:400 14px/1.58 "Segoe UI",system-ui,sans-serif!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user .oc-speaker{display:none!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user p,#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user strong{color:inherit!important;margin:0!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user a{color:inherit!important;text-decoration:underline}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user code{background:rgba(20,30,24,.22)!important;color:inherit!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.assistant{width:fit-content!important;max-width:80%!important;margin:12px auto 18px 0!important;padding:11px 16px!important;border-radius:18px 18px 18px 6px;background:var(--oc-field,#313538)!important;border:1px solid var(--oc-rule,#3e4545)!important;color:var(--oc-text,#edf1ef)!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.assistant .oc-message-actions{margin-top:8px!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user .oc-message-actions button{background:transparent!important;border:1px solid rgba(15,25,18,.35)!important;color:rgba(15,25,18,.75)!important;border-radius:7px!important;padding:3px 9px!important;font:500 11px/1.4 "Segoe UI",system-ui,sans-serif!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.user .oc-message-actions button:hover{border-color:rgba(15,25,18,.6)!important;color:var(--oc-bg,#1f2123)!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-message-actions{display:flex;gap:10px;align-items:center}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-message-actions button{background:transparent!important;border:0!important;padding:4px 4px!important;color:var(--oc-muted,#a0a8a5)!important;font-size:11px!important;cursor:pointer!important}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .ramo-w-chat.assistant .oc-message-actions button:hover{color:var(--oc-text,#eef0ef)!important}

/* The name plate stays muted and small; the bubbles carry identity. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-speaker{font:600 10px/1.4 "Segoe UI",system-ui,sans-serif!important;letter-spacing:.7px!important;text-transform:uppercase;color:var(--oc-muted,#a0a8a5)!important;margin:0 0 6px!important;opacity:1!important}

/* Internal measurements are hidden in the transcript; they live in the rail Details. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-response-stats{display:none!important}

/* Activity rows read as one-line statuses with expandable detail. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-inline-details > summary{cursor:pointer;list-style:none;color:var(--oc-soft,#d1d7d9)!important;font:500 12.5px/1.5 "Segoe UI",system-ui,sans-serif!important;padding:4px 0;opacity:.92}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-inline-details > summary::-webkit-details-marker{display:none}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-inline-details > summary::before{content:"▸ ";color:var(--oc-muted,#a0a8a5)}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-inline-details[open] > summary::before{content:"▾ "}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-inline-pre{background:var(--oc-field,#292e30);border:1px solid var(--oc-rule,#3e4545);border-radius:8px;padding:10px;max-height:280px;overflow:auto}

/* The empty state: one calm line, nothing else. */
#oc-studio-welcome{display:flex!important;flex-direction:column;align-items:center;justify-content:center;pointer-events:none!important;text-align:center}
#oc-studio-welcome[hidden]{display:none!important}
/* The right rail overlies the right of the empty state; the welcome keeps
   its outer geometry but the line only centres in the space left of the
   rail. */
#ramo-stage-overlay-v180:not(.oc-rail-closed) #oc-studio-welcome{padding-right:320px!important;box-sizing:border-box!important}
#oc-studio-welcome h1,#oc-studio-welcome>p:not(#oc-welcome-oneline){display:none!important}
#oc-welcome-oneline{display:block!important;font:400 13px/1.6 "Segoe UI",system-ui,sans-serif!important;color:var(--oc-muted,#a0a8a5)!important;margin:8px 0 0!important;background:none!important;border:0!important;padding:0!important;text-shadow:none!important}

/* One row, one baseline: marker + identity on the left, conversation title far-left-of-centre, Settings and more on the right. */
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .ramo-w-head{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:16px!important;padding:0 18px!important;min-height:66px!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-head{display:flex!important;align-items:center!important;gap:12px!important;flex:none!important;padding-left:46px!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-head-name{font:650 14.5px/1.4 "Segoe UI Variable","Segoe UI",system-ui,sans-serif!important;color:var(--oc-text,#eef0ef)!important;letter-spacing:-.1px!important;white-space:nowrap!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-head-status{display:flex!important;align-items:center!important;gap:6px!important;font:500 10.5px/1.4 "Segoe UI Variable","Segoe UI",system-ui,sans-serif!important;color:var(--oc-muted,#a0a8a5)!important;letter-spacing:.15px!important;white-space:nowrap!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-head-dot{width:7px;height:7px;border-radius:50%;background:#8be0a2;box-shadow:0 0 0 3px rgba(139,224,162,.14)}
#ramo-stage-overlay-v180.oc-occupied-home #ramo-core-layer{display:block!important;left:calc(var(--oc-pane-left, 656px) + 16px)!important;top:30px!important;width:32px!important;height:32px!important;z-index:2147483290!important}
#ramo-stage-overlay-v180.oc-occupied-home #ramo-core-layer .oc-core-caption,
#ramo-stage-overlay-v180.oc-occupied-home #ramo-core-layer .oc-core-note{display:none!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-heading{position:absolute!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;padding-left:0!important;max-width:min(46%,400px);justify-content:center!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-heading-text{align-items:center!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-chat-title{font:600 15px/1.35 "Segoe UI Variable","Segoe UI",system-ui,sans-serif!important;color:var(--oc-soft,#d1d7d9)!important;letter-spacing:-.15px!important;white-space:nowrap!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-header-actions{margin-left:auto!important;display:flex!important;align-items:center!important;gap:12px!important;flex:none!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-header-actions .oc-shell-button{height:32px!important;border-radius:8px!important;color:var(--oc-soft,#d1d7d9)!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-header-actions .oc-shell-button:hover{color:var(--oc-text,#eef0ef)!important;background:rgba(255,255,255,.04)!important}
/* The core caption is busy when it says "Ready"; the rail owns that word. */
html.oc-studio #ramo-core-layer .oc-core-caption[data-oc-idle="1"]{display:none!important}

/* The header model picker moves into the composer; the head keeps just the identity. */
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-header-model{display:none!important}
/* The studio heading's "Fast ▾" duplicates the composer chip; keep the chat title. */
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-model-label{display:none!important}

/* Composer: floating pill, chips float above, send is filled only with content. */
#ramo-composer-v180{position:absolute}
html.oc-studio #ramo-composer-v180{border-radius:22px!important;background:var(--oc-paper,#282b2d)!important;border:1px solid var(--oc-rule,#393e41)!important;box-shadow:0 18px 48px rgba(0,0,0,.45)!important;z-index:2147483200!important}
/* Textarea grows with content; no scrollbar on a single line. overflow-y stays
   a normal declaration so the inline one (set by the auto-grow / compat) wins past the cap. */
#ramo-composer-v180 #ramo-command-input-v180{font-size:14.5px!important;resize:none!important;overflow-y:hidden;overflow-x:hidden!important;line-height:1.5!important;min-height:24px!important;max-height:140px!important}
#ramo-composer-v180.oc-composer-idle #ramo-composer-send{background:transparent!important;border:1px solid var(--oc-rule,#3e4545)!important;color:var(--oc-muted,#a0a8a5)!important;box-shadow:none!important}
#ramo-composer-v180.oc-composer-ready #ramo-composer-send{background:var(--oc-accent,#a0c4b0)!important;border:1px solid transparent!important;color:var(--oc-bg,#1f2123)!important}
#ramo-composer-v180.oc-composer-idle .oc-thinking-quick,#ramo-composer-v180.oc-composer-ready .oc-thinking-quick{border:1px solid var(--oc-rule,#3e4545)!important;border-radius:10px!important;color:var(--oc-soft,#d1d7d9)!important;font:500 11px/1 "Segoe UI",system-ui,sans-serif!important;padding:0 9px!important;height:36px!important;background:transparent!important}

/* Chips that float above the composer: what the agent may touch. */
#ramo-composer-v180 .oc-scope-chips{position:absolute;left:0;right:0;bottom:calc(100% + 9px);display:flex;align-items:center;gap:7px;flex-wrap:wrap;pointer-events:none}
#ramo-composer-v180 .oc-scope-chip{display:inline-flex;align-items:center;gap:6px;pointer-events:auto;border:1px solid var(--oc-rule,#3e4545);border-radius:999px;background:var(--oc-field,#313538);color:var(--oc-soft,#d1d7d9);font:500 11.5px/1 "Segoe UI",system-ui,sans-serif;padding:5px 11px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ramo-composer-v180 button.oc-scope-chip{cursor:pointer;font-family:inherit}
#ramo-composer-v180 button.oc-scope-chip:hover{border-color:var(--oc-accent,#a0c4b0);color:var(--oc-text,#eef0ef)}
#ramo-composer-v180 .oc-scope-chip svg{width:12px;height:12px;flex:none;color:var(--oc-muted,#a0a8a5)}
#ramo-composer-v180 .oc-scope-chip.oc-scope-approval{color:#e8c98a!important;border-color:rgba(232,201,138,.35)!important}
#ramo-composer-v180 .oc-scope-chip.oc-scope-approval svg{color:#e8c98a}
#ramo-composer-v180.oc-has-scope .oc-attached-text{bottom:calc(100% + 44px)!important}
#ramo-composer-v180.oc-has-scope .oc-image-attachments{bottom:calc(100% + 44px)!important}

/* Attach images as a chip in the scope row, not a floating pill. */
#ramo-composer-v180 .oc-scope-chips .oc-image-pick{order:-1;pointer-events:auto!important;display:inline-flex!important;align-items:center;gap:6px;border:1px solid var(--oc-rule,#393e41)!important;border-radius:999px!important;background:var(--oc-field,#313538)!important;color:var(--oc-soft,#d1d7d9)!important;font:500 11.5px/1 "Segoe UI",system-ui,sans-serif!important;padding:5px 11px!important;cursor:pointer!important;white-space:nowrap!important;height:auto!important;max-width:280px}
#ramo-composer-v180 .oc-scope-chips .oc-image-pick:hover{border-color:var(--oc-accent,#a0c4b0)!important;color:var(--oc-text,#eef0ef)!important}
#ramo-composer-v180 .oc-scope-chips .oc-image-pick svg{width:12px;height:12px;color:var(--oc-muted,#a0a8a5)}
#ramo-composer-v180:has(.oc-image-preview) .oc-scope-chips{bottom:calc(100% + 62px)!important}

/* The model chip in the composer: outcome labels, one tap to change. */
#ramo-composer-v180 .oc-model-chip{display:inline-flex;align-items:center;gap:7px;flex:none;height:32px;padding:0 12px;border:1px solid var(--oc-rule,#3e4545);border-radius:10px;background:transparent;color:var(--oc-soft,#d1d7d9);font:600 11.5px/1 "Segoe UI",system-ui,sans-serif;cursor:pointer;white-space:nowrap}
#ramo-composer-v180 .oc-model-chip:hover{border-color:var(--oc-accent,#a0c4b0);color:var(--oc-text,#eef0ef)}
#ramo-composer-v180 .oc-model-chip svg{width:12px;height:12px;color:var(--oc-muted,#a0a8a5)}
#ramo-composer-v180 .oc-model-choices{position:absolute;right:8px;bottom:calc(100% + 44px);width:min(340px,calc(100vw - 40px));background:var(--oc-paper,#282b2d);border:1px solid var(--oc-rule,#393e41);border-radius:12px;box-shadow:0 16px 42px rgba(0,0,0,.5);z-index:2147483250;padding:6px;display:flex;flex-direction:column;gap:2px}
#ramo-composer-v180 .oc-model-row{display:flex;flex-direction:column;gap:1px;text-align:left;border:0;background:transparent;border-radius:9px;padding:9px 11px;cursor:pointer;color:var(--oc-text,#eef0ef)}
#ramo-composer-v180 .oc-model-row:hover{background:var(--oc-hover,#393e41)}
#ramo-composer-v180 .oc-model-row.active{outline:1px solid var(--oc-accent,#a0c4b0);outline-offset:-1px}
#ramo-composer-v180 .oc-model-row strong{font:600 12.5px/1.3 "Segoe UI",system-ui,sans-serif;color:var(--oc-text,#eef0ef)}
#ramo-composer-v180 .oc-model-row span{font:400 11px/1.35 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5)}
#ramo-composer-v180 .oc-model-row.oc-model-add{margin-top:5px;border-top:1px solid var(--oc-rule,#393e41);border-radius:0 0 9px 9px}

/* The unified toolbar: the conversation's working folder. */
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none;padding:0 8px 10px;margin:0 0 2px;border-bottom:1px solid var(--oc-rule,#393e41);color:var(--oc-text,#edf1ef);font:14px/1.6 "Segoe UI",system-ui,sans-serif}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-bar[hidden]{display:none}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-label{color:var(--oc-muted,#a0a8a5);font-size:11px;letter-spacing:.8px;text-transform:uppercase}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-folder{appearance:auto;max-width:220px;min-width:110px;height:31px;padding:3px 9px;border:1px solid var(--oc-rule,#393e41);border-radius:8px;background:var(--oc-field,#313538);color:var(--oc-text,#eef0ef);font:inherit}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-folder:disabled{opacity:.5;cursor:default}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-path{color:var(--oc-muted,#a0a8a5);font-size:12px;max-width:34ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-notice{color:#e89086;font-size:12px;margin-left:auto}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-unified-notice:empty{display:none}

/* The right rail: a window dock, flush with the right and the bottom. */
#ramo-right-rail-v1{position:absolute;top:0;right:0;bottom:0;width:300px;z-index:2147483100;pointer-events:auto;display:flex;flex-direction:column;background:var(--oc-paper,#282b2d);border-left:1px solid var(--oc-rule,#393e41);padding:10px 10px 10px;box-sizing:border-box;gap:10px;overflow:auto;scrollbar-color:#586461 transparent;transition:transform .22s ease}
#ramo-right-rail-v1[hidden]{display:none}
#ramo-stage-overlay-v180.oc-rail-closed #ramo-right-rail-v1{transform:translateX(108%)}
/* A panel-right icon: dock the rail, never a protruding tab. */
#oc-rail-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:27px;height:27px;border:1px solid var(--oc-rule,#3e4545);border-radius:7px;background:transparent;color:var(--oc-soft,#d1d7d9);cursor:pointer;padding:0}
#oc-rail-toggle:hover{border-color:var(--oc-accent,#a0c4b0);color:var(--oc-text,#eef0ef)}

/* The conversation title centres in the header regardless of the widths of its neighbours. */
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .ramo-w-head{position:relative!important}
#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-studio-heading{position:absolute!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;padding-left:0!important;max-width:min(46%,400px);justify-content:center!important}
#ramo-right-rail-v1 .oc-rail-status{display:flex;align-items:center;gap:9px;border:1px solid var(--oc-rule,#393e41);border-radius:12px;padding:8px 11px;background:var(--oc-field,#313538)}
#ramo-right-rail-v1 .oc-rail-dot{width:9px;height:9px;border-radius:50%;background:#7fc97f;flex:none}
#ramo-right-rail-v1 .oc-rail-dot.working{background:#e8c98a;animation:oc-rail-pulse 1.1s ease-in-out infinite}
@keyframes oc-rail-pulse{0%,100%{opacity:.45}50%{opacity:1}}
#ramo-right-rail-v1 .oc-rail-status-text{flex:1;min-width:0;font:500 12px/1.35 "Segoe UI",system-ui,sans-serif;color:var(--oc-soft,#d1d7d9)}
#ramo-right-rail-v1 .oc-rail-stop{flex:none;border:1px solid rgba(232,144,134,.4);background:rgba(232,144,134,.12);color:#e89086;border-radius:8px;height:28px;padding:0 11px;font:600 11px/1 "Segoe UI",system-ui,sans-serif;cursor:pointer}
#ramo-right-rail-v1 .oc-rail-stop:hover{background:rgba(232,144,134,.2)}
#ramo-right-rail-v1 .oc-rail-block{border:1px solid var(--oc-rule,#393e41);border-radius:12px;padding:10px 11px;background:var(--oc-surface,#303437)}
#ramo-right-rail-v1 .oc-rail-block h3{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 8px;font:600 11px/1.3 "Segoe UI",system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-rail-block h3 .oc-rail-count{font:600 11px/1 "Segoe UI",system-ui,sans-serif;color:var(--oc-text,#eef0ef);text-transform:none;letter-spacing:0}
#ramo-right-rail-v1 .oc-rail-empty{font:400 12px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5);margin:0}

/* What changed: files first, diffs behind a click. */
#ramo-right-rail-v1 .oc-file-row{border:1px solid var(--oc-rule,#3e4545);border-radius:10px;margin:0 0 7px;overflow:hidden;background:var(--oc-field,#313538)}
#ramo-right-rail-v1 .oc-file-row:last-child{margin-bottom:0}
#ramo-right-rail-v1 .oc-file-head{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:8px 10px;cursor:pointer}
#ramo-right-rail-v1 .oc-file-head:hover{background:rgba(255,255,255,.03)}
#ramo-right-rail-v1 .oc-file-icon{flex:none;width:17px;height:17px;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-file-name{flex:1;min-width:0;font:500 12px/1.35 "Segoe UI",system-ui,sans-serif;color:var(--oc-text,#eef0ef);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ramo-right-rail-v1 .oc-file-folder{display:block;font:400 10px/1.3 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-file-stat{flex:none;font:600 11px/1 "Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums}
#ramo-right-rail-v1 .oc-file-stat .add{color:#8fd4a8}
#ramo-right-rail-v1 .oc-file-stat .del{color:#e89086}

/* Recent: the idle space, filled with the newest changed files. */
#ramo-right-rail-v1 .oc-recent-list{display:flex;flex-direction:column;gap:1px}
#ramo-right-rail-v1 .oc-recent-row{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:8px;min-width:0}
#ramo-right-rail-v1 .oc-recent-row:hover{background:rgba(255,255,255,.03)}
#ramo-right-rail-v1 .oc-recent-icon{flex:none;width:15px;height:15px;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-recent-name{flex:1;min-width:0;font:500 12px/1.35 "Segoe UI",system-ui,sans-serif;color:var(--oc-soft,#d1d7d9);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ramo-right-rail-v1 .oc-recent-folder{display:block;font:400 10px/1.3 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-recent-stat{flex:none;font:600 11px/1 "Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums}
#ramo-right-rail-v1 .oc-recent-stat .add{color:#8fd4a8}
#ramo-right-rail-v1 .oc-recent-stat .del{color:#e89086}
#ramo-right-rail-v1 .oc-file-diff{display:none;border-top:1px solid var(--oc-rule,#3e4545);background:var(--oc-field,#2b302f);max-height:340px;overflow:auto;scrollbar-color:#586461 transparent}
#ramo-right-rail-v1 .oc-file-row.open .oc-file-diff{display:block}
#ramo-right-rail-v1 .oc-diff-line{display:grid;grid-template-columns:28px 1fr;gap:8px;padding:1px 10px;font:11.5px/1.6 Consolas,monospace;white-space:pre;overflow-wrap:anywhere}
#ramo-right-rail-v1 .oc-diff-line .gutter{color:var(--oc-muted,#a0a8a5);-webkit-user-select:none}
#ramo-right-rail-v1 .oc-diff-add{background:rgba(143,212,168,.08);color:#b8e6c9}
#ramo-right-rail-v1 .oc-diff-remove{background:rgba(232,144,134,.09);color:#f2b0a7}
#ramo-right-rail-v1 .oc-diff-context{color:var(--oc-soft,#d1d7d9)}
#ramo-right-rail-v1 .oc-more-lines{padding:6px 10px;font:11px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5);border-top:1px dashed var(--oc-rule,#3e4545)}

/* What's running / the plan. */
#ramo-right-rail-v1 .oc-plan-summary{font:500 11.5px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--oc-soft,#d1d7d9);margin:0 0 8px}
#ramo-right-rail-v1 .oc-plan-list{display:flex;flex-direction:column;gap:6px}
#ramo-right-rail-v1 .oc-plan-item{display:flex;align-items:flex-start;gap:8px;font:400 12px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--oc-soft,#d1d7d9)}
#ramo-right-rail-v1 .oc-plan-item .box{flex:none;width:13px;height:13px;margin-top:2px;border:1.5px solid var(--oc-muted,#a0a8a5);border-radius:4px;box-sizing:border-box}
#ramo-right-rail-v1 .oc-plan-item.running .box{border-color:#e8c98a;background:rgba(232,201,138,.2)}
#ramo-right-rail-v1 .oc-plan-item.done{color:var(--oc-muted,#a0a8a5);text-decoration:line-through}
#ramo-right-rail-v1 .oc-plan-item.done .box{border-color:#8fd4a8;background:#8fd4a8}
#ramo-right-rail-v1 .oc-plan-tool{display:flex;align-items:center;gap:7px;font:500 12px/1.4 "Segoe UI",system-ui,sans-serif;color:#e8c98a}
#ramo-right-rail-v1 .oc-plan-tool .spin{width:12px;height:12px;border:2px solid rgba(232,201,138,.25);border-top-color:#e8c98a;border-radius:50%;animation:oc-spin .8s linear infinite;flex:none}
@keyframes oc-spin{to{transform:rotate(360deg)}}

/* Today / scheduled: a quiet, collapsible list. */
#ramo-right-rail-v1 .oc-rail-today summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;font:600 11px/1.3 "Segoe UI",system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-rail-today summary::-webkit-details-marker{display:none}
#ramo-right-rail-v1 .oc-rail-today summary::after{content:"▸"}
#ramo-right-rail-v1 .oc-rail-today[open] summary::after{content:"▾"}
#ramo-right-rail-v1 .oc-rail-today summary span{text-transform:none;letter-spacing:0;color:var(--oc-soft,#d1d7d9);font-weight:500}

/* The hidden details: context and tokens, saved where they can be seen. */
#ramo-right-rail-v1 .oc-rail-details summary{cursor:pointer;list-style:none;font:600 11px/1.3 "Segoe UI",system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-rail-details summary::-webkit-details-marker{display:none}
#ramo-right-rail-v1 .oc-rail-details summary::before{content:"▸ "}
#ramo-right-rail-v1 .oc-rail-details[open] summary::before{content:"▾ "}
#ramo-right-rail-v1 .oc-detail-row{display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--oc-rule,#3e4545);padding:7px 2px 0;margin-top:7px;font:400 11.5px/1.45 "Segoe UI",system-ui,sans-serif}
#ramo-right-rail-v1 .oc-detail-row span{color:var(--oc-muted,#a0a8a5)}
#ramo-right-rail-v1 .oc-detail-row strong{color:var(--oc-soft,#d1d7d9);font-weight:500;font-variant-numeric:tabular-nums;text-align:right}
#ramo-right-rail-v1 .oc-copy-details{margin-top:8px;width:100%;border:1px solid var(--oc-rule,#3e4545);background:transparent;color:var(--oc-soft,#d1d7d9);border-radius:8px;padding:6px 10px;font:500 11px/1.3 "Segoe UI",system-ui,sans-serif;cursor:pointer}
#ramo-right-rail-v1 .oc-copy-details:hover{border-color:var(--oc-accent,#a0c4b0)}

/* The artifact card: finished work, offered as a card — never a code dump. */
/* The card sits in the flow and must never cover the composer's scope chips. */
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-card{max-width:1100px;margin:4px auto 216px!important;display:flex;align-items:center;gap:12px;border:1px solid var(--oc-rule,#393e41);border-radius:14px;background:var(--oc-paper,#282b2d);padding:11px 14px!important;box-shadow:0 10px 28px rgba(0,0,0,.35);position:relative;z-index:2147482501}
#ramo-composer-v180{z-index:2147483200!important}
#ramo-composer-v180 .oc-scope-chips{z-index:2147483202}

/* Tool access: the approval chip is a control, not a label. */
#ramo-composer-v180 button.oc-scope-approval{cursor:pointer;background:var(--oc-field,#313538);border-color:rgba(232,201,138,.35);color:#e8c98a;appearance:none;font:inherit}
#ramo-composer-v180 button.oc-scope-approval:hover{border-color:rgba(232,201,138,.6)}
#ramo-composer-v180 button.oc-scope-approval.oc-perm-read{color:#a8c8e0;border-color:rgba(168,200,224,.35)}
#ramo-composer-v180 button.oc-scope-approval.oc-perm-full{color:#e89086;border-color:rgba(232,144,134,.4)}
#ramo-composer-v180 .oc-permission-menu{position:absolute;left:4px;bottom:calc(100% + 46px);width:min(330px,calc(100vw - 40px));background:var(--oc-paper,#282b2d);border:1px solid var(--oc-rule,#393e41);border-radius:12px;box-shadow:0 16px 42px rgba(0,0,0,.5);z-index:2147483250;padding:6px;display:flex;flex-direction:column;gap:2px}
#ramo-composer-v180 .oc-permission-check{flex:none;color:var(--oc-accent,#a0c4b0)}

/* A plain-language dialog for the conversation's saved points and settings. */
.oc-unified-dialog{display:flex;flex-direction:column;gap:12px}
.oc-unified-dialog h2{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0;font:600 15px/1.35 "Segoe UI Variable","Segoe UI",system-ui,sans-serif;letter-spacing:-.2px;color:var(--oc-text,#eef0ef)}
.oc-unified-dialog h2 button{border:0;background:transparent;color:var(--oc-muted,#a0a8a5);font:600 11px/1 "Segoe UI",system-ui,sans-serif;border-radius:7px;padding:8px 9px;cursor:pointer;flex:none}
.oc-unified-dialog h2 button:hover{color:var(--oc-text,#eef0ef);background:var(--oc-hover,#393e41)}
.oc-unified-dialog .oc-dialog-note{font:400 12px/1.55 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5);margin:0}
.oc-unified-dialog .oc-dialog-list{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;margin:0}
.oc-unified-session{display:flex;align-items:center;gap:10px;border:1px solid var(--oc-rule,#3e4545);border-radius:11px;background:var(--oc-field,#313538);padding:10px 11px;text-align:left;cursor:pointer;color:var(--oc-text,#eef0ef)}
.oc-unified-session:hover{border-color:var(--oc-accent,#a0c4b0)}
.oc-unified-session-main{flex:1;min-width:0}
.oc-unified-session-title{display:block;font:500 12.5px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--oc-text,#eef0ef);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-unified-session-meta{display:block;font:400 10.5px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5);margin-top:2px}
.oc-unified-session-current{flex:none;font:600 10px/1 "Segoe UI",system-ui,sans-serif;color:var(--oc-accent,#a0c4b0);text-transform:uppercase;letter-spacing:.8px}
.oc-unified-session-open{flex:none;font:600 11px/1 "Segoe UI",system-ui,sans-serif;color:var(--oc-soft,#d1d7d9);border:1px solid var(--oc-rule,#3e4545);border-radius:8px;padding:8px 10px;background:transparent}
.oc-unified-row{display:flex;align-items:flex-start;gap:10px;border:1px solid transparent;border-radius:9px;padding:7px 8px}
.oc-unified-row:hover{background:rgba(255,255,255,.03)}
.oc-unified-row input[type=checkbox]{margin-top:2px;accent-color:#a0c4b0}
.oc-unified-row-main{flex:1;min-width:0}
.oc-unified-row-title{display:block;font:500 12px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--oc-text,#eef0ef)}
.oc-unified-row-sub{display:block;font:400 10.5px/1.5 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5)}
.oc-unified-h3{margin:4px 0 0;font:600 11px/1.3 "Segoe UI",system-ui,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:var(--oc-muted,#a0a8a5)}
.oc-unified-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.oc-unified-btn{border:1px solid var(--oc-rule,#3e4545);background:var(--oc-field,#313538);color:var(--oc-soft,#d1d7d9);border-radius:9px;padding:9px 14px;font:600 12px/1 "Segoe UI",system-ui,sans-serif;cursor:pointer}
.oc-unified-btn:hover{border-color:var(--oc-accent,#a0c4b0);color:var(--oc-text,#eef0ef)}
.oc-unified-btn.primary{background:var(--oc-accent,#a0c4b0);border-color:transparent;color:var(--oc-bg,#1f2123)}
.oc-unified-empty{font:400 12px/1.55 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5);margin:0;padding:4px 2px}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-icon{flex:none;width:38px;height:38px;border-radius:10px;background:var(--oc-field,#313538);display:grid;place-items:center;color:var(--oc-accent,#a0c4b0)}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-meta{flex:1;min-width:0}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-title{font:600 13px/1.35 "Segoe UI",system-ui,sans-serif;color:var(--oc-text,#eef0ef)}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-sub{font:400 11.5px/1.4 "Segoe UI",system-ui,sans-serif;color:var(--oc-muted,#a0a8a5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-actions{display:flex;gap:7px;flex:none}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-btn{border:1px solid var(--oc-rule,#3e4545);background:var(--oc-field,#313538);color:var(--oc-soft,#d1d7d9);border-radius:9px;padding:7px 12px;font:600 11.5px/1 "Segoe UI",system-ui,sans-serif;cursor:pointer}
#ramo-workspace-pane-v180 #ramo-workspace-content-v180 .oc-artifact-btn:hover{border-color:var(--oc-accent,#a0c4b0);color:var(--oc-text,#eef0ef)}
`;

	let bar = null;
	let select = null;
	let path = null;
	let notice = null;
	let projects = [];
	let projectsAt = 0;
	let toolsAt = 0;
	let changing = false;
	let busy = false;
	let busySince = 0;
	let lastArtifactKey = '';
	let lastArtifactChat = '';
	const inflightTools = new Map();

	function ensureStyle() {
		if (document.getElementById('ramo-unified-style-v1')) return;
		const style = document.createElement('style');
		style.id = 'ramo-unified-style-v1';
		style.textContent = STYLE;
		document.head.appendChild(style);
	}

	function activeChat() {
		const api = instance();
		return api?.engine?.store?.activeChat?.() || null;
	}

	/** The folder the conversation works in: a trusted project, or its own. */
	function folderOf(chat) {
		return chat?.pi?.mode === 'project' ? String(chat.pi.cwd || '') : '';
	}

	function nameOf(cwd) {
		const found = projects.find((project) => project.cwd === cwd);
		if (found?.name) return found.name;
		const parts = String(cwd || '').split(/[\\/]/).filter(Boolean);
		return parts.length ? parts[parts.length - 1] : 'Conversation folder';
	}

	function ensureRailToggle() {
		if (railToggle) return railToggle;
		railToggle = el('button', undefined, 'oc-rail-toggle');
		railToggle.id = 'oc-rail-toggle';
		railToggle.type = 'button';
		railToggle.setAttribute('aria-label', 'Show or hide the changes rail');
		railToggle.setAttribute('aria-expanded', 'true');
		railToggle.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M15 4.5v15"/></svg>';
		railToggle.addEventListener('click', () => railVisible(overlayRoot()?.classList.contains('oc-rail-closed')));
		return railToggle;
	}

	function mount(host) {
		bar = el('div', undefined, 'oc-unified-bar');
		bar.id = 'ramo-unified-bar-v1';
		const label = el('span', 'Working folder', 'oc-unified-label');
		select = el('select', undefined, 'oc-unified-folder');
		select.setAttribute('aria-label', 'Working folder of this conversation');
		path = el('span', undefined, 'oc-unified-path');
		notice = el('span', undefined, 'oc-unified-notice');
		select.onchange = () => {
			const value = select.value;
			select.value = folderOf(activeChat());
			void bind(value);
		};
		bar.append(label, select, path, ensureRailToggle(), notice);
		const head = host.querySelector('.ramo-w-head');
		if (head && head.nextSibling) host.insertBefore(bar, head.nextSibling);
		else host.insertBefore(bar, host.firstChild);
	}

	/* ------------------------------------------------------------------ */
	/* The header identity: the name and a Connected dot. No mascot.       */
	/* ------------------------------------------------------------------ */
	function ensureFace() {
		const head = document.querySelector('#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .ramo-w-head');
		if (!head || head.querySelector('.oc-head')) return;
		const identity = el('div', undefined, 'oc-head');
		identity.append(el('span', 'Ramo', 'oc-head-name'));
		const status = el('span', undefined, 'oc-head-status');
		status.append(el('span', undefined, 'oc-head-dot'), el('span', 'Connected'));
		identity.append(status);
		const heading = head.querySelector('.oc-studio-heading');
		if (heading && heading.nextSibling) head.insertBefore(identity, heading.nextSibling);
		else if (heading) head.append(identity);
		else head.prepend(identity);
	}

	/* ------------------------------------------------------------------ */
	/* The empty state: one calm line.                                     */
	/* ------------------------------------------------------------------ */
	function ensureWelcomeLine() {
		const welcome = document.getElementById('oc-studio-welcome');
		if (!welcome) return undefined;
		if (!welcome.querySelector('#oc-welcome-oneline')) {
			const line = el('p', 'Local and private — nothing leaves your machine.');
			line.id = 'oc-welcome-oneline';
			welcome.append(line);
			return line;
		}
		return welcome.querySelector('#oc-welcome-oneline');
	}

	/* ------------------------------------------------------------------ */
	/* The composer: scope chips, model chip, send discipline.             */
	/* ------------------------------------------------------------------ */
	const ICON_FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>';
	const ICON_IMAGE = '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="8.5" cy="10" r="1.3" fill="currentColor"/><path d="m5 17 5-5 4 4 3-3 2 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
	const ICON_SHIELD = '<path d="M12 3 4.5 6v6c0 4.6 3 7.8 7.5 9 4.5-1.2 7.5-4.4 7.5-9V6z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><path d="m9.5 12 2 2 3.5-3.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';

	function composerWrap() {
		return document.getElementById('ramo-composer-v180');
	}

	/* Auto-grow: the textarea sizes to its content up to 140px, never shows a
	   scrollbar on a single line, and only scrolls past the cap. */
	const COMPOSER_MAX_H = 140;
	function growComposerInput(input) {
		if (!input) return;
		input.style.height = 'auto';
		const capped = Math.min(input.scrollHeight, COMPOSER_MAX_H);
		input.style.height = `${Math.max(24, capped)}px`;
		input.style.overflowY = input.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden';
	}

	/** Fold the attach button into the scope-chip row as a chip. */
	function ensureAttachInChips() {
		const wrap = composerWrap();
		const row = wrap?.querySelector('.oc-scope-chips');
		const pick = wrap?.querySelector('.oc-image-pick');
		if (!wrap || !row || !pick) return;
		if (pick.dataset.ocChip !== '1') {
			pick.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Attach images</span>';
			pick.dataset.ocChip = '1';
		}
		if (!row.contains(pick)) row.prepend(pick);
	}

	function ensureComposerChips() {
		const wrap = composerWrap();
		if (!wrap) return;
		if (!wrap.querySelector('.oc-scope-chips')) {
			const chips = el('div', undefined, 'oc-scope-chips');
			chips.id = 'oc-scope-chips';
			wrap.prepend(chips);
		}
	}

	function updateComposerScope() {
		const wrap = composerWrap();
		const host = wrap?.querySelector('.oc-scope-chips');
		if (!wrap || !host) return;
		// The attach chip is moved in from the tray once, and the rebuild below
		// would destroy it — carry it across.
		const attachChip = host.querySelector('.oc-image-pick');
		host.replaceChildren();
		const chat = activeChat();
		const cwd = folderOf(chat);
		// The folder this conversation works in. A control: it opens the
		// toolbar's folder picker, which is the one place the folder changes.
		const folderChip = el('button', undefined, 'oc-scope-chip');
		folderChip.type = 'button';
		folderChip.setAttribute('aria-haspopup', 'listbox');
		folderChip.setAttribute('aria-label', 'Working folder: ' + (cwd ? nameOf(cwd) : 'conversation folder') + ' — click to change');
		folderChip.append(svg(ICON_FOLDER), el('span', cwd ? nameOf(cwd) : 'Conversation folder'));
		folderChip.title = cwd || 'A folder for this conversation, owned by Chat — click to change it';
		folderChip.addEventListener('click', () => openFolderPicker());
		host.append(folderChip);
		// Tool access: Ask / Read only / Full access. A control, not a label —
		// the choice persists per conversation and every turn honors it.
		const permission = String(chat?.pi?.permission || 'ask');
		const homeChip = el('button', undefined, 'oc-scope-chip oc-scope-approval' + (permission === 'read' ? ' oc-perm-read' : permission === 'full' ? ' oc-perm-full' : ''));
		homeChip.type = 'button';
		homeChip.setAttribute('aria-haspopup', 'dialog');
		homeChip.setAttribute('aria-label', 'Tool access: ' + permissionLabel(permission));
		homeChip.title = permissionHint(permission) + ' — click to change for this conversation.';
		homeChip.append(svg(ICON_SHIELD), el('span', permissionLabel(permission)));
		homeChip.addEventListener('click', () => togglePermissionMenu(homeChip));
		host.append(homeChip);
		// Attached images ride in the pending document the composer already owns.
		const previews = wrap.querySelectorAll('.oc-image-preview').length;
		if (previews > 0) {
			const imageChip = el('span', undefined, 'oc-scope-chip');
			imageChip.append(svg(ICON_IMAGE), el('span', `${previews} image${previews === 1 ? '' : 's'}`));
			imageChip.title = 'Images attached to the next message';
			host.append(imageChip);
		}
		wrap.classList.toggle('oc-has-scope', host.children.length > 0);
		// Put the attach chip back at the front, after the rebuild.
		if (attachChip) host.prepend(attachChip);
	}

	function ensureModelChip() {
		const wrap = composerWrap();
		if (!wrap || wrap.querySelector('.oc-model-chip')) return;
		const chip = el('button', undefined, 'oc-model-chip');
		chip.type = 'button';
		chip.setAttribute('aria-label', 'Choose the model');
		chip.setAttribute('aria-haspopup', 'dialog');
		const label = el('span', 'Model');
		const chevron = svg('<path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>');
		chip.append(label, chevron);
		chip.onclick = () => toggleModelMenu();
		const send = wrap.querySelector('#ramo-composer-send');
		wrap.insertBefore(chip, send);
		syncModelChip();
	}

	/** The fallback value of the shipped Fast profile, used only before the UI exists. */
	const FALLBACK_MODEL = globalThis.__ramoModelRegistry?.find?.(profile=>profile.tier==='fast')?.model||'';

	/**
	 * The same choice list the toolbar's model select uses.
	 *
	 * The select's values are the real ids the runtime accepts — the local
	 * profile names and the saved API profile ids — so the composer menu and
	 * the toolbar can never disagree about what a choice is called.
	 */
	function modelChoices() {
		const ui = globalThis.__ramoWorkspaceUIActive;
		try {
			const rows = ui?._availableModelChoices ? ui._availableModelChoices() : null;
			if (Array.isArray(rows) && rows.length) return rows;
		} catch { /* fall through to the shipped profile */ }
		return [{ name: FALLBACK_MODEL, label: 'Fast', group: 'profiles' }];
	}

	function currentModelSelect() {
		return document.querySelector('#ramo-workspace-pane-v180#ramo-workspace-pane-v180 .oc-chat-model');
	}

	/** Tier labels and provider model names are shown without assumed sizes. */
	function choiceLabel(choice) {
		const name = String(choice?.label || choice?.name || '').trim();
		if (!name) return 'Model';
		return model ? model.modelOutcome(name) : name;
	}

	function syncModelChip() {
		const wrap = composerWrap();
		const chip = wrap?.querySelector('.oc-model-chip');
		if (!chip) return;
		const value = currentModelSelect()?.value || chip.dataset.value || '';
		const choice = modelChoices().find((entry) => entry.name === value);
		const label = chip.querySelector('span');
		if (label) label.textContent = choice ? choiceLabel(choice) : String(value || 'Model');
		chip.dataset.value = value;
	}

	function selectModel(choice) {
		const target = currentModelSelect();
		if (!target) {
			try { instance()?.setModelName?.(choice.name); } catch (_) { /* the legacy API differs by build */ }
			closeModelMenu();
			syncModelChip();
			return;
		}
		target.value = choice.name;
		if (target.value !== choice.name) {
			// The toolbar has not rebuilt since the choice list changed.
			globalThis.__ramoWorkspaceUIActive?._syncModelPickers?.(true);
			target.value = choice.name;
		}
		target.dispatchEvent(new Event('change', { bubbles: true }));
		closeModelMenu();
		syncModelChip();
	}

	let modelMenuDown = null;

	function detachModelMenu() {
		if (!modelMenuDown) return;
		document.removeEventListener('pointerdown', modelMenuDown, true);
		modelMenuDown = null;
	}

	function closeModelMenu() {
		detachModelMenu();
		composerWrap()?.querySelector('.oc-model-choices')?.remove();
	}

	/** Place the menu against the chip that opened it, clamped to the window. */
	function positionModelMenu(menu, chip, wrap) {
		const chipRect = chip?.getBoundingClientRect();
		const wrapRect = wrap.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		if (!chipRect || !menuRect.width || !wrapRect.height) return;
		const left = Math.min(Math.max(8, chipRect.right - menuRect.width), Math.max(8, window.innerWidth - menuRect.width - 8));
		menu.style.right = 'auto';
		menu.style.left = `${Math.round(left - wrapRect.left)}px`;
		menu.style.bottom = `${Math.round(wrapRect.bottom - chipRect.top + 8)}px`;
	}

	function toggleModelMenu() {
		const wrap = composerWrap();
		if (!wrap) return;
		if (closeModelMenuIfOpen()) return;
		const chip = wrap.querySelector('.oc-model-chip');
		const menu = el('div', undefined, 'oc-model-choices');
		menu.setAttribute('role', 'dialog');
		menu.setAttribute('aria-label', 'Choose the model');
		const active = currentModelSelect()?.value || chip?.dataset.value || '';
		for (const choice of modelChoices()) {
			const row = el('button', undefined, 'oc-model-row');
			if (choice.name === active) row.classList.add('active');
			row.type = 'button';
			row.setAttribute('aria-pressed', String(choice.name === active));
			row.append(el('strong', choiceLabel(choice)), el('span', choice.details || choice.name));
			row.onclick = () => selectModel(choice);
			menu.append(row);
		}
		// The registry's other door: a provider model saved under Settings → API keys.
		const add = el('button', undefined, 'oc-model-row oc-model-add');
		add.type = 'button';
		add.append(el('strong', 'Add an API model…'), el('span', 'A model from a provider you have a key for'));
		add.onclick = () => {
			closeModelMenu();
			if (window.RamoStudio?.editApiModel) window.RamoStudio.editApiModel(undefined, chip);
			else flash('API models are not available in this build.');
		};
		menu.append(add);

		const send = wrap.querySelector('#ramo-composer-send');
		wrap.insertBefore(menu, send?.nextSibling || null);
		positionModelMenu(menu, chip, wrap);
		const onDown = (event) => {
			// The chip is the toggle: its own pointerdown must not close the
			// menu, or the click that follows would reopen it.
			if (menu.contains(event.target) || chip?.contains(event.target)) return;
			closeModelMenu();
		};
		modelMenuDown = onDown;
		document.addEventListener('pointerdown', onDown, true);
	}

	function closeModelMenuIfOpen() {
		const open = composerWrap()?.querySelector('.oc-model-choices');
		if (!open) return false;
		closeModelMenu();
		return true;
	}

	/* ------------------------------------------------------------------ */
	/* The conversation's runtime session: resume it or open it to this   */
	/* chat. Fork, Compact, Saved sessions and Skills & tools all work    */
	/* on this one session; Chat owns the orchestration.                 */
	/* ------------------------------------------------------------------ */
	function fingerprintOf(messages) {
		return model?.fingerprint?.(messages) || '0';
	}
	async function liveSession() {
		try { const s = await runtime.request('state'); return s?.sessionId ? s : null; } catch { return null; }
	}
	function modelId() {
		try { return String(instance()?.modelName?.() || FALLBACK_MODEL); } catch { return FALLBACK_MODEL; }
	}
	let kernelOpenPromise = null;
	async function openConversationSession() {
		const api = instance();
		const chat = activeChat();
		if (!api || !chat) throw new Error('Open a conversation first.');
		const fp = fingerprintOf(chat.messages);
		const live = await liveSession();
		if (live && live.sessionId === chat.pi?.id && chat.pi?.fingerprint === fp) return live;
		const isProject = chat.pi?.mode === 'project';
		const cwd = isProject ? String(chat.pi.cwd || '') : await runtime.request('assistantHome');
		const history = (chat.messages || []).slice(chat.contextStartIndex || 0)
			.flatMap((m) => [{ role: 'user', content: String(m.user || ''), images: [] }, { role: 'assistant', content: String(m.assistant || '') }]);
		const reuse = chat.pi?.fingerprint === fp ? chat.pi?.id : undefined;
		const result = await runtime.request('open', {
			cwd,
			mode: isProject ? 'project' : 'assistant',
			model: modelId(),
			thinking: 'off',
			sessionId: reuse,
			history,
			permission: chat.pi?.permission,
			memoryIsolation: chat.id !== 'main' && !isProject,
		});
		chat.pi = { ...chat.pi, id: result.sessionId, cwd: result.cwd, mode: result.mode || (isProject ? 'project' : 'assistant'), fingerprint: fp };
		try { api.engine?.store?.save?.(); } catch { /* store re-saves later */ }
		return result;
	}
	function ensureSession() {
		if (!kernelOpenPromise) kernelOpenPromise = openConversationSession().finally(() => { kernelOpenPromise = null; });
		return kernelOpenPromise;
	}
	function flash(message) {
		try { notice.textContent = message; return; } catch {}
		try { instance()?._showSmallStatus?.(message); } catch {}
	}

	/* ------------------------------------------------------------------ */
	/* Dialogs: the plain-language home of the saved session's work.      */
	/* ------------------------------------------------------------------ */
	const dialogEl = (title, note, width) => {
		const panel = el('section', undefined, 'oc-unified-dialog');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', title);
		panel.style.width = `min(${width || 420}px, calc(100vw - 48px))`;
		const head = el('div', undefined, 'oc-dialog-head');
		const heading = el('h2', title);
		const close = el('button', 'Close');
		close.type = 'button';
		close.onclick = () => window.RamoOverlays?.close?.();
		heading.append(close);
		head.append(heading);
		panel.append(head);
		if (note) panel.append(el('p', note, 'oc-dialog-note'));
		return panel;
	};
	function openDialog(panel, width, anchor) {
		try { window.RamoOverlays?.open?.(panel, { anchor, modal: true, width, label: panel.getAttribute('aria-label') }); return true; }
		catch (error) { flash(error?.message || 'The dialog could not open.'); return false; }
	}
	const fmtDate = (value) => { const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
	const firstLine = (value, cap) => { const line = String(value || '').split('\n')[0].trim(); return line.length > (cap || 96) ? line.slice(0, (cap || 96) - 1) + '…' : line; };
	const turnCount = (chat) => (chat?.messages || []).length;

	/** Saved sessions: the saved points of THIS conversation. */
	async function sessionsDialog(anchor) {
		const api = instance();
		const chat = activeChat();
		if (!api || !chat) return flash('Open a conversation first.');
		const cwd = chat.pi?.mode === 'project' ? String(chat.pi.cwd || '') : await runtime.request('assistantHome');
		let rows = [];
		try { rows = await runtime.request('sessions', { cwd }); } catch (error) { return flash(error?.message || 'The sessions could not be listed.'); }
		const mine = model?.filterConversationSessions ? model.filterConversationSessions(rows, chat.messages?.[0]?.user) : [];
		const fp = fingerprintOf(chat.messages);
		const panel = dialogEl('Saved sessions', 'Saved points of this conversation. Opening one continues your conversation from that point — the view you have now stays saved.', 460);
		const list = el('div', undefined, 'oc-dialog-list');
		const currentId = chat.pi?.id;
		const shown = mine.slice(0, 30);
		for (const row of shown) {
			const item = el('button', undefined, 'oc-unified-session');
			item.type = 'button';
			const main = el('span', undefined, 'oc-unified-session-main');
			main.append(el('span', firstLine(row.firstMessage, 72) || 'Saved point', 'oc-unified-session-title'));
			main.append(el('span', `${row.messageCount ?? 0} turns · ${fmtDate(row.created)}`, 'oc-unified-session-meta'));
			item.append(main);
			if (row.id === currentId) item.append(el('span', 'Current', 'oc-unified-session-current'));
			else { const open = el('span', 'Open', 'oc-unified-session-open'); item.append(open); item.addEventListener('click', () => resumeSession(row, cwd, fp)); }
			list.append(item);
		}
		if (!shown.length) list.append(el('p', 'Nothing saved yet. Ramo keeps a point each time you fork this conversation.', 'oc-unified-empty'));
		else if (mine.length > shown.length) list.append(el('p', `… and ${mine.length - shown.length} more saved points`, 'oc-unified-empty'));
		panel.append(list);
		openDialog(panel, undefined, anchor);
	}
	async function resumeSession(row, cwd, fp) {
		const api = instance();
		const chat = activeChat();
		if (!api || !chat) return;
		if (instance()?.session) return flash('Wait for the current answer to finish first.');
		const isProject = chat.pi?.mode === 'project';
		try {
			const result = await runtime.request('open', { cwd, mode: isProject ? 'project' : 'assistant', model: modelId(), thinking: 'off', sessionId: row.id, memoryIsolation: chat.id !== 'main' && !isProject });
			chat.pi = { ...chat.pi, id: result.sessionId, cwd: result.cwd || cwd, mode: result.mode || (isProject ? 'project' : 'assistant'), fingerprint: fp };
			try { api.engine?.store?.save?.(); } catch { /* re-saves later */ }
			flash('Opened the saved point — the conversation continues there.');
			window.RamoOverlays?.close?.();
		} catch (error) { flash(error?.message || 'The saved point could not open.'); }
	}

	/** Export: Markdown, a readable web page, or the session log. */
	function download(name, content, type) {
		const url = URL.createObjectURL(new Blob([content], { type: type || 'text/plain' }));
		const a = el('a');
		a.href = url; a.download = name; a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	const markdownOf = (chat) => (chat?.messages || []).map((m) => `**You**\n\n${String(m.user || '')}\n\n**Ramo**\n\n${String(m.assistant || '')}`).join('\n\n---\n\n');
	function htmlOf(chat) {
		const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const turns = (chat?.messages || []).map((m) => `<section class="turn"><h2>You</h2><p>${esc(m.user).replace(/\n/g, '<br>')}</p><h2>Ramo</h2><p>${esc(m.assistant).replace(/\n/g, '<br>')}</p></section>`).join('\n');
		const title = esc(chat?.title || 'Ramo conversation');
		return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{max-width:760px;margin:48px auto;padding:0 20px;font:16px/1.65 Georgia,serif;color:#242a25;background:#f7f6ef}h1{font-size:24px;letter-spacing:-.3px}h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#6d7a6e;margin:26px 0 6px}p{white-space:normal}section.turn{border-top:1px solid #d8d6cc;padding-top:10px}</style></head><body><h1>${title}</h1>${turns}</body></html>`;
	}
	function exportDialog(anchor) {
		const api = instance();
		const chat = activeChat();
		if (!api || !chat) return flash('Open a conversation first.');
		const panel = dialogEl('Export this conversation', 'Save it as a file. Nothing leaves your computer.', 400);
		const actions = el('div', undefined, 'oc-unified-actions');
		const name = String(chat.title || 'ramo-conversation').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'ramo-conversation';
		const mk = (text, onClick, primary) => { const b = el('button', text, 'oc-unified-btn' + (primary ? ' primary' : '')); b.type = 'button'; b.addEventListener('click', onClick); return b; };
		const md = mk('Markdown', () => { download(`${name}.md`, markdownOf(chat), 'text/markdown'); flash('Exported as Markdown.'); }, true);
		const htmlBtn = mk('Web page', () => { download(`${name}.html`, htmlOf(chat), 'text/html'); flash('Exported as a web page.'); });
		const jsonl = mk('Session log', async () => {
			if (instance()?.session) return flash('Wait for the current answer to finish first.');
			try { await ensureSession(); const result = await runtime.request('exportFile', {}); if (result) flash('Session log saved.'); }
			catch (error) { flash(error?.message || 'The session log could not be exported.'); }
		});
		actions.append(md, htmlBtn, jsonl);
		panel.append(actions);
		panel.append(el('p', 'Session log is the machine format Ramo itself uses; it needs a live session, so it opens one first.', 'oc-dialog-note'));
		openDialog(panel, undefined, anchor);
	}

	/** Compact: summarize older turns; full history stays. */
	async function compactNow(anchor) {
		const chat = activeChat();
		if (instance()?.session) return flash('Wait for the current answer to finish first.');
		if (!turnCount(chat)) return flash('Nothing to compact yet — the conversation is just getting started.');
		flash('Compacting the conversation — older turns become one summary…');
		await ensureSession();
		await runtime.request('compact');
		flash('Context compacted. Full history stays saved in Saved sessions.');
	}

	/** Fork: save this point and continue on a new branch. */
	async function forkChat(anchor) {
		const api = instance();
		const before = activeChat();
		if (instance()?.session) return flash('Wait for the current answer to finish first.');
		if (!turnCount(before)) return flash('Fork needs at least one turn. Try after an answer lands.');
		const baseTitle = String(before?.title || 'This conversation').trim();
		const previousId = before?.id;
		await ensureSession();
		const result = await runtime.request('fork');
		if (!result?.sessionId) throw new Error('The fork did not open.');
		// The fork pipeline forks into a new conversation entry (or the saved
		// one, when the runtime reattaches); keep it legible.
		const now = activeChat();
		if (now && previousId && now.id !== previousId) {
			try { await api?.renameChatSession?.(now.id, `${baseTitle} · fork`); } catch { /* rename is cosmetic */ }
		}
		flash('Forked — this conversation continues on a saved branch. Earlier points are in Saved sessions.');
	}

	/** Skills & tools: the kernel's real list, in plain words. */
	async function skillsDialog(anchor) {
		await ensureSession();
		const data = await runtime.request('resources');
		const panel = dialogEl('Skills & tools', 'What Ramo may do in this conversation, and the reusable instructions it knows.', 460);
		const list = el('div', undefined, 'oc-dialog-list');
		panel.append(list);

		const tools = el('h3', 'Tools', 'oc-unified-h3');
		list.append(tools);
		const toolNames = Array.isArray(data?.tools) ? data.tools : [];
		const active = new Set(Array.isArray(data?.activeTools) ? data.activeTools : []);
		const selected = new Set(active);
		const applyTools = async () => { try { await runtime.request('settings', { tools: [...selected] }); flash('Tools updated.'); } catch (error) { flash(error?.message || 'The tools could not be updated.'); } };
		if (!toolNames.length) list.append(el('p', 'No tools available.', 'oc-unified-empty'));
		for (const tool of toolNames) {
			const row = el('label', undefined, 'oc-unified-row');
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.checked = selected.has(tool.name);
			input.setAttribute('aria-label', `Allow ${tool.name}`);
			input.addEventListener('change', () => { if (input.checked) selected.add(tool.name); else selected.delete(tool.name); void applyTools(); });
			const main = el('span', undefined, 'oc-unified-row-main');
			main.append(el('span', tool.name, 'oc-unified-row-title'), el('span', tool.description || '', 'oc-unified-row-sub'));
			row.append(input, main);
			list.append(row);
		}

		const skills = el('h3', 'Skills', 'oc-unified-h3');
		list.append(skills);
		const skillRows = Array.isArray(data?.skills) ? data.skills : [];
		if (!skillRows.length) list.append(el('p', 'No skills yet. Drop a SKILL.md into this project or your agent folder.', 'oc-unified-empty'));
		for (const skill of skillRows) {
			const row = el('div', undefined, 'oc-unified-row');
			const main = el('span', undefined, 'oc-unified-row-main');
			main.append(el('span', skill.name + (skill.disableModelInvocation ? ' · hidden from the model prompt' : ''), 'oc-unified-row-title'));
			if (skill.description) main.append(el('span', skill.description, 'oc-unified-row-sub'));
			row.append(main);
			list.append(row);
		}

		const prompts = el('h3', 'Prompt templates', 'oc-unified-h3');
		list.append(prompts);
		const promptRows = Array.isArray(data?.prompts) ? data.prompts : [];
		if (!promptRows.length) list.append(el('p', 'No templates yet. Drop a .md file into the prompts folder of this project or your agent folder, then type /name to run it.', 'oc-unified-empty'));
		for (const prompt of promptRows) {
			const row = el('div', undefined, 'oc-unified-row');
			const main = el('span', undefined, 'oc-unified-row-main');
			main.append(el('span', `/${prompt.name}${prompt.argumentHint ? ' ' + prompt.argumentHint : ''}`, 'oc-unified-row-title'));
			if (prompt.description) main.append(el('span', prompt.description, 'oc-unified-row-sub'));
			row.append(main);
			list.append(row);
		}

		list.append(el('h3', 'Extensions', 'oc-unified-h3'));
		list.append(el('p', 'Pi extensions are not supported here. Ramo runs its own kernel; the tools, skills and templates above are what it reads.', 'oc-unified-empty'));
		for (const diagnostic of data?.diagnostics || []) list.append(el('p', String(diagnostic), 'oc-unified-row-sub'));
		openDialog(panel, undefined, anchor);
	}

	/* Tool access from the approval chip: the persistent read/ask control. */
	const PERMISSION_MODES = [
		{ level: 'ask', label: 'Ask before changes', detail: 'Confirm before files are written or commands run. The default.' },
		{ level: 'read', label: 'Read only', detail: 'Ramo can read files, but can never write or run commands.' },
		{ level: 'full', label: 'Full access', detail: 'No confirmation for writing files or running commands.' },
	];
	function permissionLabel(level) { return (PERMISSION_MODES.find((mode) => mode.level === level) || PERMISSION_MODES[0]).label; }
	function permissionHint(level) { return (PERMISSION_MODES.find((mode) => mode.level === level) || PERMISSION_MODES[0]).detail; }
	function setPermission(level) {
		const api = instance();
		const chat = activeChat();
		if (!chat) return;
		chat.pi = { ...chat.pi, permission: level };
		try { api.engine?.store?.save?.(); } catch { /* re-saves later */ }
		try { if (api?.session) void runtime.request('settings', { permission: level }).catch(() => {}); } catch { /* the turn honors it */ }
		closePermissionMenu();
		updateComposerScope();
		flash(permissionLabel(level) + ' — for this conversation');
	}
	function closePermissionMenu() { composerWrap()?.querySelector('.oc-permission-menu')?.remove(); }
	function togglePermissionMenu(anchor) {
		const wrap = composerWrap();
		if (!wrap) return;
		const existing = wrap.querySelector('.oc-permission-menu');
		if (existing) { existing.remove(); return; }
		const current = String(activeChat()?.pi?.permission || 'ask');
		const menu = el('div', undefined, 'oc-permission-menu');
		menu.setAttribute('role', 'dialog');
		menu.setAttribute('aria-label', 'Tool access for this conversation');
		for (const mode of PERMISSION_MODES) {
			const row = el('button', undefined, 'oc-model-row');
			row.type = 'button';
			if (mode.level === current) row.classList.add('active');
			const strong = el('strong', mode.label);
			if (mode.level === current) strong.append(el('span', '✓', 'oc-permission-check'));
			row.append(strong, el('span', mode.detail));
			row.onclick = () => setPermission(mode.level);
			menu.append(row);
		}
		const send = wrap.querySelector('#ramo-composer-send');
		wrap.insertBefore(menu, send?.nextSibling || null);
		const onDown = (event) => { if (menu.contains(event.target)) return; menu.remove(); document.removeEventListener('pointerdown', onDown, true); };
		document.addEventListener('pointerdown', onDown, true);
	}

	window.RamoUnified = { sessionsDialog, exportDialog, compactNow, forkChat, skillsDialog };

	function updateSendFill() {
		const wrap = composerWrap();
		if (!wrap) return;
		const input = wrap.querySelector('#ramo-command-input-v180');
		const state = model ? model.sendState(input?.value, busy) : 'send';
		wrap.classList.toggle('oc-composer-idle', state === 'empty');
		wrap.classList.toggle('oc-composer-ready', state !== 'empty');
	}

	/* ------------------------------------------------------------------ */
	/* The right rail: what changed, what is running, today, details.      */
	/* ------------------------------------------------------------------ */
	let rail = null;
	let railToggle = null;
	let lastChanges = [];
	const overlayRoot = () => document.getElementById('ramo-stage-overlay-v180');
	const railOpenSaved = () => { try { return localStorage.getItem('ramo-rail-open') !== '0'; } catch { return true; } };

	function railVisible(open) {
		const root = overlayRoot();
		if (!root) return;
		root.classList.toggle('oc-rail-closed', !open);
		try { localStorage.setItem('ramo-rail-open', open ? '1' : '0'); } catch (_) {}
		if (railToggle) railToggle.setAttribute('aria-expanded', String(open));
		// The rail reserve is part of the content box: the pane, the composer
		// and the core move with it, in the same frame.
		globalThis.__ramoWorkspaceUIActive?._layoutNow?.();
	}

	function ensureRail() {
		const pane = document.getElementById('ramo-workspace-pane-v180');
		if (!pane) return;
		if (!rail) {
			rail = el('aside', undefined, undefined);
			rail.id = 'ramo-right-rail-v1';
			rail.setAttribute('aria-label', 'What changed and what is running');

			const status = el('div', undefined, 'oc-rail-status');
			status.id = 'oc-rail-status';
			status.innerHTML = '<span class="oc-rail-dot" id="oc-rail-dot"></span><span class="oc-rail-status-text" id="oc-rail-status-text">Ready</span><button class="oc-rail-stop" id="oc-rail-stop" type="button" hidden>Stop</button>';
			status.querySelector('.oc-rail-stop').addEventListener('click', () => {
				void runtime.request('abort').catch(() => {});
			});
			status.querySelector('.oc-rail-dot');
			rail.append(status);

			const changes = el('section', undefined, 'oc-rail-block oc-rail-changes');
			changes.innerHTML = '<h3>What changed <span class="oc-rail-count" id="oc-changes-count"></span></h3><div class="oc-rail-files" id="oc-rail-files"><p class="oc-rail-empty">No file changes yet.</p></div>';
			rail.append(changes);

			const plan = el('section', undefined, 'oc-rail-block oc-rail-plan');
			plan.innerHTML = '<h3>What\'s running</h3><p class="oc-plan-summary" id="oc-plan-summary">Idle</p><div class="oc-plan-list" id="oc-plan-list"></div>';
			rail.append(plan);

			const today = el('details', undefined, 'oc-rail-block oc-rail-today');
			today.open = true;
			today.innerHTML = '<summary>Today <span id="oc-today-count"></span></summary><div class="oc-plan-list" id="oc-today-list" style="margin-top:8px"><p class="oc-rail-empty">No tasks yet. Ask Ramo to plan something.</p></div>';
			rail.append(today);

			// The idle space: the last few things that changed, newest first, reusing
			// exactly what the changes block already reads — never a new data source.
			const recent = el('section', undefined, 'oc-rail-block oc-rail-recent');
			recent.innerHTML = '<h3>Recent</h3><div class="oc-recent-list" id="oc-rail-recent"><p class="oc-rail-empty">Nothing yet — changes and activity will show up here.</p></div>';
			rail.append(recent);

			const details = el('details', undefined, 'oc-rail-block oc-rail-details');
			details.innerHTML = '<summary>Details</summary>'
				+ '<div class="oc-detail-row"><span>Model</span><strong id="oc-detail-model">—</strong></div>'
				+ '<div class="oc-detail-row"><span>Context used</span><strong id="oc-detail-context">—</strong></div>'
				+ '<div class="oc-detail-row"><span>Last reply</span><strong id="oc-detail-output">—</strong></div>'
				+ '<button class="oc-copy-details" id="oc-copy-details" type="button">Copy technical details</button>';
			details.querySelector('#oc-copy-details').addEventListener('click', () => {
				const text = [
					'Model: ' + (details.querySelector('#oc-detail-model')?.textContent || '—'),
					'Context: ' + (details.querySelector('#oc-detail-context')?.textContent || '—'),
					'Last reply: ' + (details.querySelector('#oc-detail-output')?.textContent || '—'),
				].join('\n');
				void navigator.clipboard?.writeText(text);
			});
			rail.append(details);
		
			const host = overlayRoot() || pane;
			host.append(rail);
		}
		if (!overlayRoot()?.dataset.ocRailInit) {
			if (overlayRoot()) overlayRoot().dataset.ocRailInit = '1';
			railVisible(railOpenSaved());
		}
	}

	/** Render the changed files with their diffs. */
	function renderChanges(changes) {
		if (!rail) return;
		const host = rail.querySelector('#oc-rail-files');
		const count = rail.querySelector('#oc-changes-count');
		const list = Array.isArray(changes) ? changes.filter((entry) => entry && typeof entry.path === 'string') : [];
		lastChanges = list;
		const unique = [...new Map(list.map((entry) => [entry.path, entry])).values()];
		if (count) count.textContent = unique.length ? String(unique.length) : '';
		// The poll re-renders; a diff the user expanded stays expanded.
		const openPaths = new Set([...host.querySelectorAll('.oc-file-row.open')].map((row) => row.dataset.path || ''));
		host.replaceChildren();
		if (!unique.length) {
			host.append(el('p', 'No file changes yet.', 'oc-rail-empty'));
			renderRecent();
			return;
		}
		for (const entry of unique) {
			const label = model ? model.fileLabel(entry.path) : entry.path;
			const folder = model ? model.folderName(entry.path) : '';
			const stat = model ? model.diffStat(entry.before, entry.after) : { added: 0, removed: 0 };
			const row = el('div', undefined, 'oc-file-row');
			row.dataset.path = entry.path;

			const head = el('button', undefined, 'oc-file-head');
			head.type = 'button';
			head.setAttribute('aria-expanded', 'false');
			const icon = svg('<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M14 3v4h4" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>', 'oc-file-icon');
			const name = el('span', undefined, 'oc-file-name');
			name.textContent = label;
			if (folder) name.append(el('span', folder, 'oc-file-folder'));
			const statNode = el('span', undefined, 'oc-file-stat');
			statNode.innerHTML = `<span class="add">+${stat.added}</span> <span class="del">−${stat.removed}</span>`;
			head.append(icon, name, statNode);

			const diffHost = el('div', undefined, 'oc-file-diff');
			head.addEventListener('click', () => {
				const open = row.classList.toggle('open');
				head.setAttribute('aria-expanded', String(open));
			});
			const diff = model ? model.diffLines(entry.before, entry.after) : { rows: [], kind: 'empty' };
			const MAX = 160;
			const rows = diff.rows.slice(0, MAX);
			let content = '';
			for (const r of rows) {
				const cls = r.type === 'add' ? 'oc-diff-add' : r.type === 'remove' ? 'oc-diff-remove' : 'oc-diff-context';
				const text = (r.text === undefined || r.text === null) ? '' : String(r.text);
				content += `<div class="oc-diff-line ${cls}"><span class="gutter">${r.type === 'add' ? '+' : r.type === 'remove' ? '−' : ' '}</span><span>${escapeHtml(text)}</span></div>`;
			}
			diffHost.innerHTML = content;
			if (diff.rows.length > MAX) diffHost.append(el('div', `… and ${diff.rows.length - MAX} more lines`, 'oc-more-lines'));
			if (entry.before === '[File over 1 MiB; diff omitted]') diffHost.append(el('div', 'This file is over 1 MiB; the diff was not recorded.', 'oc-more-lines'));
			else if (entry.before === null) diffHost.append(el('div', 'This file did not exist before the change.', 'oc-more-lines'));
			if (openPaths.has(entry.path)) {
				row.classList.add('open');
				head.setAttribute('aria-expanded', 'true');
			}
			row.append(head, diffHost);
			host.append(row);
		}
		renderRecent();
	}

	/** The idle space: the last few changed files, newest first, max 5. Reuses the
	    exact entries the changes block reads — no new data source. */
	function renderRecent() {
		if (!rail) return;
		const host = rail.querySelector('#oc-rail-recent');
		if (!host) return;
		host.replaceChildren();
		const newest = [];
		const seen = new Set();
		for (let i = lastChanges.length - 1; i >= 0 && newest.length < 5; i -= 1) {
			const entry = lastChanges[i];
			if (!entry || typeof entry.path !== 'string' || seen.has(entry.path)) continue;
			seen.add(entry.path);
			newest.push(entry);
		}
		if (!newest.length) {
			host.append(el('p', 'Nothing yet — changes and activity will show up here.', 'oc-rail-empty'));
			return;
		}
		for (const entry of newest) {
			const label = model ? model.fileLabel(entry.path) : entry.path;
			const folder = model ? model.folderName(entry.path) : '';
			const stat = model ? model.diffStat(entry.before, entry.after) : { added: 0, removed: 0 };
			const row = el('div', undefined, 'oc-recent-row');
			const icon = svg('<path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/><path d="M14 3v4h4" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/>', 'oc-recent-icon');
			const name = el('span', undefined, 'oc-recent-name');
			name.textContent = label;
			if (folder) name.append(el('span', folder, 'oc-recent-folder'));
			const statNode = el('span', undefined, 'oc-recent-stat');
			statNode.innerHTML = `<span class="add">+${stat.added}</span> <span class="del">−${stat.removed}</span>`;
			row.append(icon, name, statNode);
			host.append(row);
		}
	}

	function escapeHtml(value) {
		return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	/** The plan panel: the task list and who is running right now. */
	function renderPlan() {
		if (!rail) return;
		const summary = rail.querySelector('#oc-plan-summary');
		const list = rail.querySelector('#oc-plan-list');
		const today = document.getElementById('oc-today-list');
		const todayCount = document.getElementById('oc-today-count');

		let todos = [];
		try { todos = instance()?.harness?.tasks?.()?.todos || []; } catch { todos = []; }
		const stats = model ? model.todoStats(todos) : { pending: 0, running: 0, done: 0 };

		const parts = model ? model.planSummary(todos) : '';
		if (summary) summary.textContent = parts || (busy ? 'Working' : 'Idle');

		list.replaceChildren();
		if (busy && inflightTools.size) {
			for (const name of [...inflightTools.keys()].slice(0, 3)) {
				const row = el('div', undefined, 'oc-plan-tool');
				const spin = el('span', undefined, 'spin');
				row.append(spin, el('span', name));
				list.append(row);
			}
		} else if (todos.length) {
			for (const todo of (model ? model.orderTodos(todos) : todos).slice(0, 6)) {
				const row = el('div', undefined, 'oc-plan-item' + (todo.status === 'in_progress' ? ' running' : todo.status === 'completed' ? ' done' : ''));
				const box = el('span', undefined, 'box');
				row.append(box, el('span', String(todo.content || '').slice(0, 160)));
				list.append(row);
			}
			if (todos.length > 6) list.append(el('p', `… and ${todos.length - 6} more`, 'oc-rail-empty'));
		} else if (!busy) {
			list.append(el('p', 'Nothing running. Ask Ramo to do something.', 'oc-rail-empty'));
		}

		// Today: the open and recently finished tasks of this conversation.
		if (today) {
			today.replaceChildren();
			const open = todos.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled');
			const done = todos.filter((todo) => todo.status === 'completed');
			if (todayCount) todayCount.textContent = open.length ? `${open.length} open` : done.length ? `${done.length} done` : '';
			if (!todos.length) {
				today.append(el('p', 'No tasks yet. Ask Ramo to plan something.', 'oc-rail-empty'));
			} else {
				for (const todo of [...open, ...done.slice(-2)].slice(0, 6)) {
					const row = el('div', undefined, 'oc-plan-item' + (todo.status === 'completed' ? ' done' : ''));
					const box = el('span', undefined, 'box');
					row.append(box, el('span', String(todo.content || '').slice(0, 160)));
					today.append(row);
				}
			}
		}
	}

	/** The quiet status pill: what, and how long, and one Stop. */
	function renderStatus() {
		if (!rail) return;
		const text = rail.querySelector('#oc-rail-status-text');
		const stop = rail.querySelector('.oc-rail-stop');
		const dot = rail.querySelector('#oc-rail-dot');
		if (!text || !stop || !dot) return;
		dot.classList.toggle('working', busy);
		if (busy) {
			const running = [...inflightTools.keys()];
			const label = running.length ? `Running ${running[running.length - 1]}` : 'Working';
			text.textContent = model ? `${label} · ${model.runningFor(busySince, Date.now())}` : label;
			stop.hidden = false;
		} else {
			text.textContent = 'Ready';
			stop.hidden = true;
		}
	}

	/** The hidden Details: context and tokens, still visible here. */
	function renderDetails(state) {
		if (!rail) return;
		const chip = document.querySelector('#ramo-composer-v180 .oc-model-chip span');
		const modelOut = rail.querySelector('#oc-detail-model');
		const ctxOut = rail.querySelector('#oc-detail-context');
		const outputOut = rail.querySelector('#oc-detail-output');
		if (modelOut) modelOut.textContent = chip?.textContent || '—';
		const used = Number(state?.context?.tokens);
		const windowTokens = Number(state?.generation?.contextWindow || state?.context?.contextWindow);
		if (ctxOut) {
			ctxOut.textContent = Number.isFinite(used) && Number.isFinite(windowTokens) && windowTokens > 0
				? `${Math.round(used).toLocaleString()} / ${Math.round(windowTokens).toLocaleString()} (${Math.round((used / windowTokens) * 100)}%)`
				: '—';
		}
		const messages = Array.isArray(state?.messages) ? state.messages : [];
		const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
		const output = Number(lastAssistant?.usage?.output);
		if (outputOut) outputOut.textContent = Number.isFinite(output) && output > 0 ? `${output.toLocaleString()} tokens` : '—';
	}

	/* ------------------------------------------------------------------ */
	/* The artifact card: a receipt for finished work.                     */
	/* ------------------------------------------------------------------ */
	const ARTIFACT_BUTTON = (label, onClick) => {
		const b = el('button', label, 'oc-artifact-btn');
		b.type = 'button';
		b.addEventListener('click', () => void onClick());
		return b;
	};

	function maybeInsertArtifactCard(changes, state) {
		const scroll = document.querySelector('#ramo-workspace-content-v180 .ramo-chat-scroll');
		if (!scroll) return;
		const list = Array.isArray(changes) ? changes.filter((entry) => entry && typeof entry.path === 'string') : [];
		if (!list.length) return;
		const key = `${activeChat()?.id || ''}:${list.map((entry) => entry.path).join('|')}`;
		if (key === lastArtifactKey) return;
		lastArtifactKey = key;
		const files = model ? model.changeLines(list, 4) : { total: list.length, shown: list.slice(0, 4), remaining: 0 };
		const card = el('article', undefined, 'oc-artifact-card');
		const iconRoom = el('div', undefined, 'oc-artifact-icon');
		iconRoom.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4h4"/><path d="M9.5 13.5 11.5 15.5 15 12"/></svg>';
		const meta = el('div', undefined, 'oc-artifact-meta');
		meta.append(el('div', `Changed ${files.total} file${files.total === 1 ? '' : 's'}`, 'oc-artifact-title'));
		const sub = files.shown.map((entry) => model ? model.fileLabel(entry.path) : entry.path).join(', ') + (files.remaining ? `, +${files.remaining} more` : '');
		meta.append(el('div', sub, 'oc-artifact-sub'));
		const actions = el('div', undefined, 'oc-artifact-actions');
		actions.append(
			ARTIFACT_BUTTON('Open', () => runtime.request('showFolder')),
			ARTIFACT_BUTTON('Diff', () => railVisible(true)),
			ARTIFACT_BUTTON('Save', () => runtime.request('exportFile')),
		);
		card.append(iconRoom, meta, actions);
		// The card lives outside .ramo-reading on purpose: the compat
		// re-render reconciles the reading by position and drops unknown
		// children, so a card inside it would not survive the next poll. The
		// scroll node persists within the chat.
		scroll.append(card);
	}

	/* ------------------------------------------------------------------ */
	/* Events from the runtime: live tool rows and busy edges.             */
	/* ------------------------------------------------------------------ */
	function watchEvents() {
		if (typeof runtime.onEvent !== 'function') return;
		try {
			runtime.onEvent((event) => {
				if (!event || typeof event !== 'object') return;
				if (event.type === 'tool_execution_start') {
					inflightTools.set(String(event.toolName || 'tool'), Date.now());
					renderStatus();
					renderPlan();
					return;
				}
				if (event.type === 'tool_execution_end') {
					inflightTools.delete(String(event.toolName || 'tool'));
					renderStatus();
					renderPlan();
					return;
				}
				if (event.type === 'agent_settled' || event.type === 'manual_end') {
					inflightTools.clear();
					void finishTurn(true);
					return;
				}
				if (event.type === 'worker_exit') {
					inflightTools.clear();
					busy = false;
					renderStatus();
					renderPlan();
				}
			});
		} catch { /* old builds without onEvent */ }
	}

	/** A turn just finished: pull the truth from the runtime. */
	async function finishTurn(fromBusyEdge = false) {
		const wasBusy = busy || fromBusyEdge;
		busy = false;
		renderStatus();
		renderPlan();
		try {
			const changes = await runtime.request('changes').catch(() => []);
			renderChanges(changes);
			if (wasBusy) maybeInsertArtifactCard(changes, null);
		} catch { /* the rail keeps its last truth */ }
	}

	/* ------------------------------------------------------------------ */
	/* The unified toolbar's data.                                         */
	/* ------------------------------------------------------------------ */
	function fillSelect(current) {
		const wanted = ['', ...projects.map((project) => project.cwd)].join('|');
		if (select.dataset.keys !== wanted) {
			select.dataset.keys = wanted;
			select.replaceChildren();
			const own = el('option', 'Conversation folder');
			own.value = '';
			select.append(own);
			for (const project of projects) {
				const option = el('option', project.name || nameOf(project.cwd));
				option.value = project.cwd;
				select.append(option);
			}
		}
		if (select.value !== current) select.value = current;
	}

	/**
	 * The folder chip above the composer and the toolbar's folder select are
	 * one control: the chip opens the select, the select owns the choice.
	 */
	function openFolderPicker() {
		const picker = select || document.querySelector('#ramo-unified-bar-v1 .oc-unified-folder');
		if (!picker) return;
		picker.focus();
		try { picker.showPicker?.(); } catch { /* focus is the fallback */ }
	}

	/**
	 * Point the conversation at a folder.
	 *
	 * The chat record is the renderer's, so the record is what changes. The
	 * session is opened again by the runtime, which is the only place that
	 * decides what the model may then do.
	 */
	async function bind(cwd) {
		const api = instance();
		const chat = activeChat();
		if (!api || !chat || changing) return;
		changing = true;
		select.disabled = true;
		notice.textContent = '';
		try {
			chat.pi = { ...(chat.pi || {}), mode: cwd ? 'project' : 'assistant', cwd: cwd || undefined, id: undefined, fingerprint: '' };
			if (!api.engine.store.save()) throw Error('The working folder could not be saved.');
			await runtime.request('state');
			api._restoreChatSurface?.();
		} catch (error) {
			notice.textContent = error?.message || String(error);
		} finally {
			changing = false;
			select.disabled = false;
			refresh();
		}
	}

	/** The runtime's own view of whether a turn is in flight. */
	async function refreshTools() {
		try {
			const state = await runtime.request('state');
			if (state?.sessionId) busy = !!state.busy;
		} catch {
			// The runtime has no session open, or the worker is gone.
		}
	}

	async function refreshProjects(force) {
		const now = Date.now();
		if (!force && now - projectsAt < 15000) return;
		projectsAt = now;
		try {
			const rows = await runtime.request('projects');
			projects = Array.isArray(rows) ? rows : [];
		} catch {
			projects = [];
		}
	}

	/** Name plates and the core caption: only the rail owns the word "Ready". */
	function quietNamePlates() {
		for (const node of document.querySelectorAll('#ramo-workspace-content-v180 .oc-speaker')) {
			const text = (node.textContent || '').trim().toUpperCase();
			if (text === 'YOU' || text === 'RAMO' || text === 'RAMO · LIVE') {
				node.style.display = 'none';
			} else {
				node.style.display = '';
			}
		}
		const coreCaption = document.querySelector('.oc-core-caption');
		if (coreCaption) {
			// "Ready" belongs to the rail pill; live phases stay visible. The
			// studio stylesheet wins with `display:block!important`, so the
			// idle state rides on a data attribute the unified stylesheet
			// overrides.
			if ((coreCaption.textContent || '').trim() === 'Ready') coreCaption.dataset.ocIdle = '1';
			else delete coreCaption.dataset.ocIdle;
		}
	}

	/** Long code blocks collapse; the language stays readable. */
	function collapseLongCode() {
		for (const pre of document.querySelectorAll('#ramo-workspace-content-v180 .ramo-reading pre')) {
			if (pre.dataset.ocCode) continue;
			pre.dataset.ocCode = '1';
			const lines = (pre.textContent || '').split('\n').length;
			if (lines > 24) {
				pre.classList.add('oc-code-collapsible');
				pre.addEventListener('dblclick', () => pre.classList.toggle('oc-code-expanded'));
				pre.title = 'Double-click to expand or collapse';
			}
		}
	}

	function refresh() {
		const host = document.getElementById('ramo-workspace-pane-v180');
		if (!host) return;
		if (!bar) {
			ensureStyle();
			mount(host);
			void refreshProjects(true);
		}
		bar.hidden = host.classList.contains('page-mode');
		const chat = activeChat();
		const current = folderOf(chat);
		fillSelect(current);
		const folder = current || '';
		path.textContent = folder ? folder : 'No project — folder of its own';
		path.title = folder || 'No project — the conversation has a folder of its own';
		const running = chat?.attempt?.status === 'running';
		if (!changing) select.disabled = running;
		// A different chat starts with a fresh artifact key.
		const artifactChat = String(chat?.id || '');
		if (artifactChat !== lastArtifactChat) {
			lastArtifactChat = artifactChat;
			lastArtifactKey = '';
		}

		ensureFace();
		const welcomeLine = ensureWelcomeLine();
		const chatNow = activeChat();
		const occupiedNow = !!(chatNow?.messages?.some?.((m) => String(m?.user || m?.assistant || '').trim()) || instance()?.session);
		if (welcomeLine) welcomeLine.style.display = occupiedNow ? 'none' : '';
		const root = overlayRoot();
		if (root) root.classList.toggle('oc-occupied-home', occupiedNow);
		// Geometry belongs to the workspace layout, which publishes the one
		// content box (sidebar → rail) that the pane, the composer and the core
		// all read. Refresh the published values; never compute a second set.
		globalThis.__ramoWorkspaceUIActive?._publishContentBox?.();
		ensureRail();
		// The rail starts below the unified bar so the header keeps its click
		// targets; its top aligns with the content area and its bottom docks
		// with the window.
		if (rail && bar && root) {
			const hostRect = root.getBoundingClientRect();
			const barRect = bar.getBoundingClientRect();
			const top = bar.hidden ? 0 : Math.max(0, Math.round(barRect.bottom - hostRect.top)) + 1;
			rail.style.top = `${top}px`;
		}
		ensureComposerChips();
		ensureAttachInChips();
		const composer = composerWrap();
		if (composer) {
			const input = composer.querySelector('#ramo-command-input-v180');
			if (input && !input.dataset.ocScopeHooked) {
				input.dataset.ocScopeHooked = '1';
				input.addEventListener('input', () => updateSendFill());
			}
			if (input && !input.dataset.ocAutogrowHooked) {
				input.dataset.ocAutogrowHooked = '1';
				input.addEventListener('input', () => growComposerInput(input));
			}
			growComposerInput(input);
			ensureModelChip();
			syncModelChip();
			const wasBusy = busy;
			const baseBusy = (instance()?.session != null);
			if (baseBusy !== busy) {
				busy = baseBusy;
				if (busy) busySince = Date.now();
			}
			if (wasBusy !== busy) {
				if (!busy) void finishTurn(true);
			}
			updateComposerScope();
			updateSendFill();
		}

		quietNamePlates();
		collapseLongCode();
		renderStatus();
		renderPlan();
	}

	function tick() {
		refresh();
		const now = Date.now();
		if (now - toolsAt > 1500) {
			toolsAt = now;
			void refreshTools();
			void runtime.request('changes').then(renderChanges).catch(() => {});
			void runtime.request('state').then(renderDetails).catch(() => {});
		}
		if (now - projectsAt > 15000) void refreshProjects(false);
	}

	ensureStyle();
	watchEvents();
	refresh();
	setInterval(tick, 1000);
})();
