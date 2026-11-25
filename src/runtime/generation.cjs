'use strict';
// Qwen3.6's official card recommends 32,768 for ordinary queries in either mode.
const OUTPUT_TOKENS=32768;
function thinkingMode(value){return value==='off'?'off':['high','xhigh','max'].includes(value)?'max':'on';}
function piThinking(value){const mode=thinkingMode(value);return mode==='on'?'medium':mode==='max'?'high':'off';}
function requestPolicy(payload,value){const mode=thinkingMode(value);return {...payload,max_tokens:mode==='max'?-1:Math.min(Number(payload.max_tokens)>0?Number(payload.max_tokens):OUTPUT_TOKENS,OUTPUT_TOKENS),chat_template_kwargs:{...payload.chat_template_kwargs,enable_thinking:mode!=='off'},ramo_work_mode:mode};}
function compactionPolicy(context=65536){const size=Math.max(1024,Number(context)||65536);return {enabled:true,reserveTokens:Math.min(16384,Math.floor(size/4)),keepRecentTokens:Math.min(8192,Math.floor(size/8))};}
module.exports={OUTPUT_TOKENS,thinkingMode,piThinking,requestPolicy,compactionPolicy};
