export const MOBILE_STYLE_TEXT: string = `
  @media (max-width: 768px) {
    .app-body:has(> [data-pi-web-sidebar-plugin]:not([hidden])) {
      grid-template-columns: minmax(0, 1fr) !important;
    }

    .app-body:has(> [data-pi-web-sidebar-plugin]:not([hidden])) > :is(
      main,
      .main,
      .prompt-region,
      [data-main],
      [data-plugin-chat-root],
      [data-plugin-composer-root],
      [data-view='workspace'],
      [data-view='picker'],
      [data-plugin-sidebar],
      [data-pi-web-sidebar-plugin]
    ) {
      grid-column: 1 !important;
      min-width: 0;
    }

    [data-pi-web-sidebar-plugin]:not([hidden]) {
      position: fixed;
      inset: 0 auto 0 0; z-index: 999;
      width: min(86vw, 320px);
      max-width: calc(100vw - 48px);
    }

    [data-pi-web-sidebar-plugin] .sb-resizer { display: none; }
  }
`;
