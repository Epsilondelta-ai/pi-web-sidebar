export function pickerMarkup(): string {
  return [
    "<style>",
    "[data-pi-web-sidebar-picker][hidden]{display:none}",
    "[data-pi-web-sidebar-picker]{position:fixed;inset:0;z-index:120;display:grid;place-items:center;background:rgba(0,0,0,.45)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-dialog{width:min(720px,calc(100vw - 32px));height:min(640px,calc(100vh - 32px));display:grid;grid-template-rows:auto auto 1fr auto;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-2,14px);box-shadow:0 24px 80px rgba(0,0,0,.5);overflow:hidden}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-head,[data-pi-web-sidebar-picker] .pi-sidebar-picker-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid var(--border-dim,var(--border))}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-actions{border-top:1px solid var(--border-dim,var(--border));border-bottom:0}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-path{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-dim,var(--border))}",
    "[data-pi-web-sidebar-picker] input{flex:1;min-width:0;border:1px solid var(--border);border-radius:9px;background:var(--bg-1);color:var(--fg-0);font:12px/1 var(--font-mono);padding:8px 10px}",
    "[data-pi-web-sidebar-picker] button{border:1px solid var(--border);border-radius:9px;background:var(--bg-1);color:var(--fg-1);font:12px/1 var(--font-mono);padding:8px 10px;cursor:pointer}",
    "[data-pi-web-sidebar-picker] button:hover{border-color:var(--accent);color:var(--accent)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-list{overflow:auto;padding:6px}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-row{width:100%;display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;text-align:left;background:transparent;border:0;border-radius:8px;padding:9px 10px}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-row:hover{background:var(--bg-3)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-row small{color:var(--fg-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-picker-error{color:var(--danger,#f87171);font-size:12px;min-height:1em}",
    "[data-pi-web-sidebar-picker] [data-clone-dialog][hidden],[data-pi-web-sidebar-picker] [data-new-folder-dialog][hidden]{display:none}",
    "[data-pi-web-sidebar-picker] [data-clone-dialog],[data-pi-web-sidebar-picker] [data-new-folder-dialog]{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.42)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-form-dialog{width:min(460px,calc(100vw - 48px));display:grid;gap:10px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-2,14px);box-shadow:0 20px 60px rgba(0,0,0,.5);padding:14px}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-form-dialog label{display:grid;gap:6px;color:var(--fg-2);font:12px/1 var(--font-mono)}",
    "[data-pi-web-sidebar-picker] .pi-sidebar-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}",
    "</style>",
    '<section class="pi-sidebar-picker-dialog" role="dialog" aria-modal="true" aria-label="open workspace">',
    '<div class="pi-sidebar-picker-head"><strong>open workspace</strong><button type="button" data-picker-action="close">close</button></div>',
    '<form class="pi-sidebar-picker-path" data-picker-path-form><input name="path" autocomplete="off" spellcheck="false"><button type="submit">go</button></form>',
    '<div class="pi-sidebar-picker-list" data-picker-list></div>',
    pickerActionsMarkup(),
    "</section>",
    folderDialogMarkup(),
    cloneDialogMarkup(),
  ].join("");
}

function pickerActionsMarkup(): string {
  return [
    '<div class="pi-sidebar-picker-actions"><span class="pi-sidebar-picker-error" data-picker-error></span><span>',
    '<button type="button" data-picker-action="new-folder">new folder</button> ',
    '<button type="button" data-picker-action="clone">clone</button> ',
    '<button type="button" data-picker-action="refresh">refresh</button> ',
    '<button type="button" data-picker-action="open-current">open current</button>',
    "</span></div>",
  ].join("");
}

function folderDialogMarkup(): string {
  return [
    "<div data-new-folder-dialog hidden>",
    '<form class="pi-sidebar-form-dialog" data-new-folder-form><strong>new folder</strong>',
    '<label>folder name<input name="name" autocomplete="off" spellcheck="false" required></label>',
    '<div class="pi-sidebar-form-actions">',
    '<button type="button" data-picker-action="new-folder-cancel">cancel</button>',
    '<button type="submit">create</button>',
    "</div></form></div>",
  ].join("");
}

function cloneDialogMarkup(): string {
  return [
    "<div data-clone-dialog hidden>",
    '<form class="pi-sidebar-form-dialog" data-clone-form><strong>clone repository</strong>',
    '<label>git url<input name="gitUrl" autocomplete="off" spellcheck="false" placeholder="https://github.com/user/repo.git" required></label>',
    '<label>folder name <input name="name" autocomplete="off" spellcheck="false" placeholder="optional"></label>',
    '<div class="pi-sidebar-form-actions">',
    '<button type="button" data-picker-action="clone-cancel">cancel</button>',
    '<button type="submit">clone</button>',
    "</div></form></div>",
  ].join("");
}
